import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAckFilePath, getAcksDirPath, readAckLeases } from "../acks.js";

const ACK_TIMEOUT_MS = 30 * 60 * 1000;

describe("acks", () => {
	beforeEach(() => {
		vol.reset();
	});

	afterEach(() => {
		vol.reset();
	});

	describe("readAckLeases", () => {
		it("returns an empty list when acks/ does not exist", async () => {
			vol.mkdirSync("/downloads", { recursive: true });
			const logger = createMockLogger();

			const leases = (await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger))._unsafeUnwrap();

			expect(leases).toEqual([]);
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it("returns an empty list when acks/ is empty", async () => {
			vol.mkdirSync(getAcksDirPath("/downloads"), { recursive: true });
			const logger = createMockLogger();

			const leases = (await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger))._unsafeUnwrap();

			expect(leases).toEqual([]);
		});

		it("reads a fresh ack lease", async () => {
			vol.mkdirSync(getAcksDirPath("/downloads"), { recursive: true });
			vol.writeFileSync(
				getAckFilePath("/downloads", "kiosk-1"),
				JSON.stringify({ versionId: "20260714T153045Z" }),
			);
			const now = new Date("2026-07-14T15:35:00.000Z");
			vol.utimesSync(getAckFilePath("/downloads", "kiosk-1"), now, now);
			const logger = createMockLogger();

			const leases = (
				await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger, now)
			)._unsafeUnwrap();

			expect(leases).toEqual([
				{
					consumerId: "kiosk-1",
					versionId: "20260714T153045Z",
					ackedAt: now,
					fresh: true,
				},
			]);
		});

		it("marks an ack lease older than ackTimeout as not fresh", async () => {
			vol.mkdirSync(getAcksDirPath("/downloads"), { recursive: true });
			vol.writeFileSync(
				getAckFilePath("/downloads", "kiosk-1"),
				JSON.stringify({ versionId: "20260714T153045Z" }),
			);
			const mtime = new Date("2026-07-14T15:00:00.000Z");
			vol.utimesSync(getAckFilePath("/downloads", "kiosk-1"), mtime, mtime);
			const now = new Date(mtime.getTime() + ACK_TIMEOUT_MS + 1000);
			const logger = createMockLogger();

			const leases = (
				await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger, now)
			)._unsafeUnwrap();

			expect(leases).toEqual([
				{
					consumerId: "kiosk-1",
					versionId: "20260714T153045Z",
					ackedAt: mtime,
					fresh: false,
				},
			]);
		});

		it("ignores unparseable JSON with a logged warning", async () => {
			vol.mkdirSync(getAcksDirPath("/downloads"), { recursive: true });
			vol.writeFileSync(getAckFilePath("/downloads", "kiosk-1"), "{not json");
			const logger = createMockLogger();

			const leases = (await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger))._unsafeUnwrap();

			expect(leases).toEqual([]);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unparseable"));
		});

		it("ignores a lease missing versionId with a logged warning", async () => {
			vol.mkdirSync(getAcksDirPath("/downloads"), { recursive: true });
			vol.writeFileSync(
				getAckFilePath("/downloads", "kiosk-1"),
				JSON.stringify({ hello: "world" }),
			);
			const logger = createMockLogger();

			const leases = (await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger))._unsafeUnwrap();

			expect(leases).toEqual([]);
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unparseable"));
		});

		it("ignores non-.json files in acks/", async () => {
			vol.mkdirSync(getAcksDirPath("/downloads"), { recursive: true });
			vol.writeFileSync(`${getAcksDirPath("/downloads")}/.DS_Store`, "junk");
			const logger = createMockLogger();

			const leases = (await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger))._unsafeUnwrap();

			expect(leases).toEqual([]);
			expect(logger.warn).not.toHaveBeenCalled();
		});

		it("reads multiple consumers independently", async () => {
			vol.mkdirSync(getAcksDirPath("/downloads"), { recursive: true });
			vol.writeFileSync(
				getAckFilePath("/downloads", "kiosk-1"),
				JSON.stringify({ versionId: "20260714T153045Z" }),
			);
			vol.writeFileSync(
				getAckFilePath("/downloads", "kiosk-2"),
				JSON.stringify({ versionId: "20260714T163045Z" }),
			);
			const logger = createMockLogger();

			const leases = (await readAckLeases("/downloads", ACK_TIMEOUT_MS, logger))._unsafeUnwrap();

			expect(leases.map((lease) => lease.consumerId).sort()).toEqual(["kiosk-1", "kiosk-2"]);
		});
	});
});
