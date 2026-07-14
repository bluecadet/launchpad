import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { errAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAckFilePath, getAcksDirPath } from "../acks.js";
import { getVersionsDirPath, sweepVersions } from "../retention-sweep.js";
import * as FileUtils from "../utils/file-utils.js";

const ACK_TIMEOUT_MS = 30 * 60 * 1000;
const DOWNLOAD_PATH = "/downloads";

function makeVersionDir(versionId: string) {
	const versionPath = `${getVersionsDirPath(DOWNLOAD_PATH)}/${versionId}`;
	vol.mkdirSync(`${versionPath}/source1`, { recursive: true });
	vol.writeFileSync(`${versionPath}/source1/file.json`, "{}");
	return versionPath;
}

function writeManifest(activeVersionId: string) {
	vol.writeFileSync(
		`${DOWNLOAD_PATH}/manifest.json`,
		JSON.stringify({
			schemaVersion: 1,
			versionId: activeVersionId,
			versionPath: `versions/${activeVersionId}`,
			generatedAt: "2026-07-14T15:30:47.000Z",
			sources: [{ sourceId: "source1", path: "source1" }],
		}),
	);
}

function writeAck(consumerId: string, versionId: string, mtime: Date) {
	const ackPath = getAckFilePath(DOWNLOAD_PATH, consumerId);
	vol.mkdirSync(getAcksDirPath(DOWNLOAD_PATH), { recursive: true });
	vol.writeFileSync(ackPath, JSON.stringify({ versionId }));
	vol.utimesSync(ackPath, mtime, mtime);
}

describe("sweepVersions", () => {
	beforeEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vol.reset();
		vi.restoreAllMocks();
	});

	it("returns an empty result when versions/ does not exist yet", async () => {
		vol.mkdirSync(DOWNLOAD_PATH, { recursive: true });
		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 3, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();

		expect(result).toEqual({
			retainedVersionIds: [],
			deletedVersionIds: [],
			pendingDeleteVersionIds: [],
			acks: [],
		});
	});

	it("keeps only the newest N version dirs when there's no active version or acks", async () => {
		for (const versionId of [
			"20260101T000000Z",
			"20260102T000000Z",
			"20260103T000000Z",
			"20260104T000000Z",
			"20260105T000000Z",
		]) {
			makeVersionDir(versionId);
		}
		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 3, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();

		expect(result.retainedVersionIds.sort()).toEqual([
			"20260103T000000Z",
			"20260104T000000Z",
			"20260105T000000Z",
		]);
		expect(result.deletedVersionIds.sort()).toEqual(["20260101T000000Z", "20260102T000000Z"]);
		expect(result.pendingDeleteVersionIds).toEqual([]);
		expect(vol.existsSync(`${getVersionsDirPath(DOWNLOAD_PATH)}/20260101T000000Z`)).toBe(false);
		expect(vol.existsSync(`${getVersionsDirPath(DOWNLOAD_PATH)}/20260105T000000Z`)).toBe(true);
	});

	it("extends retention for the manifest's active version even if older than keep-N", async () => {
		for (const versionId of [
			"20260101T000000Z",
			"20260102T000000Z",
			"20260103T000000Z",
			"20260104T000000Z",
		]) {
			makeVersionDir(versionId);
		}
		writeManifest("20260101T000000Z");
		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 2, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();

		expect(result.retainedVersionIds.sort()).toEqual([
			"20260101T000000Z",
			"20260103T000000Z",
			"20260104T000000Z",
		]);
		expect(result.deletedVersionIds).toEqual(["20260102T000000Z"]);
	});

	it("extends retention for a fresh ack lease outside keep-N", async () => {
		for (const versionId of ["20260101T000000Z", "20260102T000000Z", "20260103T000000Z"]) {
			makeVersionDir(versionId);
		}
		const now = new Date("2026-07-14T15:35:00.000Z");
		writeAck("kiosk-1", "20260101T000000Z", now);
		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 1, ackTimeout: ACK_TIMEOUT_MS }, logger, now)
		)._unsafeUnwrap();

		expect(result.retainedVersionIds.sort()).toEqual(["20260101T000000Z", "20260103T000000Z"]);
		expect(result.deletedVersionIds).toEqual(["20260102T000000Z"]);
		expect(result.acks).toEqual([
			{ consumerId: "kiosk-1", versionId: "20260101T000000Z", ackedAt: now, fresh: true },
		]);
	});

	it("does not extend retention for a stale ack lease (dead consumer can never block cleanup past ackTimeout)", async () => {
		for (const versionId of ["20260101T000000Z", "20260102T000000Z", "20260103T000000Z"]) {
			makeVersionDir(versionId);
		}
		const mtime = new Date("2026-07-14T15:00:00.000Z");
		writeAck("kiosk-1", "20260101T000000Z", mtime);
		const now = new Date(mtime.getTime() + ACK_TIMEOUT_MS + 1000);
		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 1, ackTimeout: ACK_TIMEOUT_MS }, logger, now)
		)._unsafeUnwrap();

		expect(result.retainedVersionIds).toEqual(["20260103T000000Z"]);
		expect(result.deletedVersionIds.sort()).toEqual(["20260101T000000Z", "20260102T000000Z"]);
		expect(result.acks[0]?.fresh).toBe(false);
	});

	it("is pure count-based retention when acks/ is empty", async () => {
		for (const versionId of ["20260101T000000Z", "20260102T000000Z"]) {
			makeVersionDir(versionId);
		}
		vol.mkdirSync(getAcksDirPath(DOWNLOAD_PATH), { recursive: true });
		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 1, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();

		expect(result.retainedVersionIds).toEqual(["20260102T000000Z"]);
		expect(result.deletedVersionIds).toEqual(["20260101T000000Z"]);
	});

	it("ages out crash debris under the same rule as any other version dir (no orphan special-casing)", async () => {
		// Crash debris from a failed promotion is minted via the same version-id format as any
		// successful one -- it's just an ordinary, never-referenced dir in `versions/`.
		makeVersionDir("20260101T000000Z");
		makeVersionDir("20260102T000000Z"); // never promoted; no manifest entry, no ack
		makeVersionDir("20260103T000000Z");
		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 1, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();

		expect(result.retainedVersionIds).toEqual(["20260103T000000Z"]);
		expect(result.deletedVersionIds.sort()).toEqual(["20260101T000000Z", "20260102T000000Z"]);
	});

	it("leaves a dir eligible next pass and reports it as pending-delete when removal fails", async () => {
		makeVersionDir("20260101T000000Z");
		makeVersionDir("20260102T000000Z");
		makeVersionDir("20260103T000000Z");

		const realRemove = FileUtils.remove;
		const removeSpy = vi.spyOn(FileUtils, "remove").mockImplementation((dir, options) => {
			if (dir.endsWith("20260101T000000Z")) {
				return errAsync(new FileUtils.FileUtilsError("locked"));
			}
			return realRemove(dir, options);
		});

		const logger = createMockLogger();

		const result = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 1, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();

		expect(result.pendingDeleteVersionIds).toEqual(["20260101T000000Z"]);
		expect(result.deletedVersionIds).toEqual(["20260102T000000Z"]);
		expect(vol.existsSync(`${getVersionsDirPath(DOWNLOAD_PATH)}/20260101T000000Z`)).toBe(true);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("20260101T000000Z"));

		removeSpy.mockRestore();
	});

	it("re-derives eligibility fresh on the next sweep, retrying a pending-delete dir", async () => {
		makeVersionDir("20260101T000000Z");
		makeVersionDir("20260102T000000Z");
		const logger = createMockLogger();

		const realRemove = FileUtils.remove;
		const removeSpy = vi
			.spyOn(FileUtils, "remove")
			.mockImplementationOnce(() => errAsync(new FileUtils.FileUtilsError("locked")))
			.mockImplementation((dir, options) => realRemove(dir, options));

		const firstPass = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 1, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();
		expect(firstPass.pendingDeleteVersionIds).toEqual(["20260101T000000Z"]);
		expect(vol.existsSync(`${getVersionsDirPath(DOWNLOAD_PATH)}/20260101T000000Z`)).toBe(true);

		const secondPass = (
			await sweepVersions(DOWNLOAD_PATH, { keep: 1, ackTimeout: ACK_TIMEOUT_MS }, logger)
		)._unsafeUnwrap();
		expect(secondPass.deletedVersionIds).toEqual(["20260101T000000Z"]);
		expect(vol.existsSync(`${getVersionsDirPath(DOWNLOAD_PATH)}/20260101T000000Z`)).toBe(false);

		removeSpy.mockRestore();
	});
});
