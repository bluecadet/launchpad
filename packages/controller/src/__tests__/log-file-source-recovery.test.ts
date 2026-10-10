import { randomUUID } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeLogRecord } from "@bluecadet/launchpad-utils/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeBarrier, parseJson } from "../core/log-file-codec.js";
import { createLogFileSource, type LogFileSourceOwner } from "../core/log-file-source.js";
import { unwrap } from "./log-result-test-utils.js";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
}));

const directories: string[] = [];
const owners: LogFileSourceOwner[] = [];
const signal = new AbortController().signal;
const request = { maxEntries: 100, maxBytes: 1_000_000, signal };

async function setup(options: Omit<Parameters<typeof createLogFileSource>[0], "directory"> = {}) {
	const directory = await mkdtemp(path.join(tmpdir(), "launchpad-recovery-"));
	directories.push(directory);
	const owner = unwrap(createLogFileSource({ ...options, directory }));
	owners.push(owner);
	owner.append(
		unwrap(
			normalizeLogRecord(
				{
					timestamp: new Date(),
					level: "info",
					event: "log:info",
					message: "retained",
					metadata: {},
				},
				{},
			),
		),
	);
	unwrap(await owner.source.flush(signal));
	const name = (await readdir(directory)).find((name) => name.endsWith(".jsonl"));
	if (!name) throw new Error("Expected a canonical file");
	return { directory, owner, canonical: path.join(directory, name) };
}

afterEach(async () => {
	vi.restoreAllMocks();
	for (const owner of owners.splice(0)) await owner.close(signal);
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("checkpoint recovery", () => {
	it.each([
		"future sequence",
		"foreign segment",
		"future retention",
		"future truncation",
		"future offset",
	])("quarantines a %s and conservatively replays retained records", async (kind) => {
		const { directory, owner } = await setup();
		const reader = unwrap(await owner.source.createReader({ checkpointId: "recovery" }, signal));
		const batch = unwrap(await reader.read(request));
		unwrap(await reader.ack(batch.receipt, signal));
		unwrap(await reader.close(signal));
		const checkpointDirectory = path.join(directory, "checkpoints");
		const name = (await readdir(checkpointDirectory))[0];
		if (!name) throw new Error("Expected a checkpoint");
		const checkpointPath = path.join(checkpointDirectory, name);
		const position = decodeBarrier(
			unwrap(await owner.source.flush(signal)),
			owner.source.identity.sourceId,
		);
		if (kind === "future sequence") position.segmentSequence = 9000;
		if (kind === "foreign segment") position.segmentId = randomUUID();
		if (kind === "future retention") position.seenRetentionGeneration = 9000;
		if (kind === "future truncation") position.seenTruncationGeneration = 9000;
		if (kind === "future offset") position.offset += 9000;
		const corrupt = JSON.stringify({
			formatVersion: 1,
			sourceId: owner.source.identity.sourceId,
			checkpointId: "recovery",
			cursor: position,
		});
		await writeFile(checkpointPath, corrupt);
		const resumed = unwrap(await owner.source.createReader({ checkpointId: "recovery" }, signal));
		const recovered = unwrap(await resumed.read(request));
		expect(recovered.records.map((record) => record.message)).toEqual(["retained"]);
		expect(recovered.gaps).toContainEqual(expect.objectContaining({ reason: "corruption" }));
		const quarantine = (await readdir(checkpointDirectory)).find((name) =>
			name.includes(".corrupt-"),
		);
		expect(quarantine).toBeDefined();
		if (!quarantine) throw new Error("Expected quarantine");
		expect(await readFile(path.join(checkpointDirectory, quarantine), "utf8")).toBe(corrupt);
		unwrap(await resumed.close(signal));
		const unacknowledged = unwrap(
			await owner.source.createReader({ checkpointId: "recovery" }, signal),
		);
		const repeated = unwrap(await unacknowledged.read(request));
		expect(repeated.gaps).toContainEqual(expect.objectContaining({ reason: "corruption" }));
		unwrap(await unacknowledged.ack(repeated.receipt, signal));
		unwrap(await unacknowledged.close(signal));
		const acknowledged = unwrap(
			await owner.source.createReader({ checkpointId: "recovery" }, signal),
		);
		const empty = unwrap(await acknowledged.read(request));
		expect(empty.records).toEqual([]);
		expect(empty.gaps).toEqual([]);
	});
	it("keeps a deleted valid checkpoint as a retention gap rather than quarantining it", async () => {
		const day = 24 * 60 * 60 * 1000;
		let now = Date.parse("2026-01-01T00:00:00Z");
		const { directory, owner } = await setup({ now: () => now, maxAgeMs: day });
		const reader = unwrap(await owner.source.createReader({ checkpointId: "retained" }, signal));
		unwrap(await reader.close(signal));
		unwrap(await owner.close(signal));
		now += 3 * day;
		const reopened = unwrap(createLogFileSource({ directory, now: () => now, maxAgeMs: day }));
		owners.push(reopened);
		const resumed = unwrap(
			await reopened.source.createReader({ checkpointId: "retained" }, signal),
		);
		const batch = unwrap(await resumed.read(request));
		expect(batch.records).toEqual([]);
		expect(batch.gaps).toEqual([expect.objectContaining({ reason: "retention" })]);
		expect(
			(await readdir(path.join(directory, "checkpoints"))).some((name) =>
				name.includes(".corrupt-"),
			),
		).toBe(false);
		unwrap(await resumed.ack(batch.receipt, signal));
		expect(unwrap(await resumed.read(request)).gaps).toEqual([]);
	});
});

describe("source lease release failures", () => {
	it.each([false, true])(
		"reports a release failure while preserving a primary I/O failure: %s",
		async (failIO) => {
			const { owner } = await setup();
			const nativeFileExtensions: typeof import("fs-native-extensions").default = createRequire(
				import.meta.url,
			)("fs-native-extensions");
			const unlock = vi.spyOn(nativeFileExtensions, "unlock").mockImplementation(() => {
				throw new Error("native unlock failed");
			});
			if (failIO) {
				vi.spyOn(fsPromises, "rename").mockRejectedValue(new Error("canonical seal failed"));
			}
			const result = await owner.close(signal);
			expect(result._unsafeUnwrapErr().message).toBe(
				failIO ? "canonical seal failed" : "native unlock failed",
			);
			expect(unlock).toHaveBeenCalledOnce();
			expect(owner.source.status).toMatchObject({
				available: false,
				lastError: expect.stringContaining(
					failIO ? "canonical seal failed" : "native unlock failed",
				),
			});
		},
	);
});

describe("oversized corruption", () => {
	it.each([1_000_000, 16_384])(
		"skips one complete oversized active line in bounded reads of %i bytes",
		async (maxBytes) => {
			const { directory, owner, canonical } = await setup();
			const valid = await readFile(canonical, "utf8");
			await writeFile(canonical, `${"x".repeat(300_000)}\n${valid}`);
			const reader = unwrap(await owner.source.createReader({ checkpointId: "oversized" }, signal));
			const opened = fsPromises.open;
			let readBytes = 0;
			vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
				const handle = await opened(...args);
				if (String(args[0]).endsWith(".jsonl")) {
					const read = handle.read.bind(handle);
					vi.spyOn(handle, "read").mockImplementation(
						async (...readArgs: Parameters<typeof handle.read>) => {
							const buffer = readArgs[0];
							if (Buffer.isBuffer(buffer)) {
								expect(buffer.length).toBeLessThanOrEqual(Math.min(maxBytes, 262_146));
								readBytes += buffer.length;
							}
							return read(...readArgs);
						},
					);
				}
				return handle;
			});
			const records: string[] = [];
			const gaps: string[] = [];
			for (let attempt = 0; attempt < 25 && records.length === 0; attempt++) {
				readBytes = 0;
				const batch = unwrap(await reader.read({ ...request, maxBytes }));
				expect(readBytes).toBeLessThanOrEqual(maxBytes);
				records.push(...batch.records.map((record) => record.message));
				gaps.push(...batch.gaps.map((gap) => gap.reason));
				unwrap(await reader.ack(batch.receipt, signal));
			}
			expect(records).toEqual(["retained"]);
			expect(gaps).toEqual(["corruption"]);
			vi.restoreAllMocks();
			unwrap(await reader.close(signal));
			const sameOwnerReader = unwrap(
				await owner.source.createReader({ checkpointId: "oversized" }, signal),
			);
			const sameOwnerEmpty = unwrap(await sameOwnerReader.read(request));
			expect(sameOwnerEmpty.records).toEqual([]);
			expect(sameOwnerEmpty.gaps).toEqual([]);
			unwrap(await sameOwnerReader.close(signal));
			unwrap(await owner.close(signal));
			const reopened = unwrap(createLogFileSource({ directory }));
			owners.push(reopened);
			const resumed = unwrap(
				await reopened.source.createReader({ checkpointId: "oversized" }, signal),
			);
			const empty = unwrap(await resumed.read(request));
			expect(empty.records).toEqual([]);
			expect(empty.gaps).toEqual([]);
		},
	);

	it.each([1_000_000, 16_384])(
		"does not acknowledge an oversized partial EOF with a %i-byte budget",
		async (maxBytes) => {
			const { owner, canonical } = await setup();
			await writeFile(canonical, "x".repeat(300_000));
			const reader = unwrap(await owner.source.createReader({ checkpointId: "partial" }, signal));
			for (let attempt = 0; attempt < 22; attempt++) {
				const batch = unwrap(await reader.read({ ...request, maxBytes }));
				expect(batch.records).toEqual([]);
				expect(batch.gaps).toEqual([]);
				const receipt = parseJson(
					Buffer.from(batch.receipt, "base64url").toString("utf8"),
					"receipt",
				);
				expect(receipt).toMatchObject({ cursor: { offset: 0 } });
				unwrap(await reader.ack(batch.receipt, signal));
			}
			await appendFile(canonical, "\n");
			const gaps: string[] = [];
			for (let attempt = 0; attempt < 22 && gaps.length === 0; attempt++) {
				const complete = unwrap(await reader.read({ ...request, maxBytes }));
				gaps.push(...complete.gaps.map((gap) => gap.reason));
				unwrap(await reader.ack(complete.receipt, signal));
			}
			expect(gaps).toEqual(["corruption"]);
			expect(unwrap(await reader.read(request)).gaps).toEqual([]);
		},
	);

	it("makes bounded oversized recovery progress while owner appends continue", async () => {
		const { owner, canonical } = await setup();
		const valid = await readFile(canonical, "utf8");
		await writeFile(canonical, `${"x".repeat(300_000)}\n${valid}`);
		const reader = unwrap(await owner.source.createReader({ checkpointId: "growing" }, signal));
		const messages: string[] = [];
		const gaps: string[] = [];
		for (let attempt = 0; attempt < 25; attempt++) {
			owner.append(
				unwrap(
					normalizeLogRecord(
						{
							timestamp: new Date(),
							level: "info",
							event: "log:info",
							message: `appended-${attempt}`,
							metadata: {},
						},
						{},
					),
				),
			);
			unwrap(await owner.source.flush(signal));
			const batch = unwrap(await reader.read({ ...request, maxBytes: 16_384 }));
			messages.push(...batch.records.map((record) => record.message));
			gaps.push(...batch.gaps.map((gap) => gap.reason));
			unwrap(await reader.ack(batch.receipt, signal));
		}
		expect(gaps).toEqual(["corruption"]);
		expect(messages).toEqual([
			"retained",
			...Array.from({ length: 25 }, (_, index) => `appended-${index}`),
		]);
	});

	it("resets scan progress when the prefix changes before an owner append", async () => {
		const { owner, canonical } = await setup();
		const valid = await readFile(canonical, "utf8");
		const damaged = `${"x".repeat(300_000)}\n${valid}`;
		await writeFile(canonical, damaged);
		const reader = unwrap(
			await owner.source.createReader({ checkpointId: "changed-prefix" }, signal),
		);
		const partial = unwrap(await reader.read({ ...request, maxBytes: 16_384 }));
		expect(partial.records).toEqual([]);
		unwrap(await reader.ack(partial.receipt, signal));
		await writeFile(canonical, `${valid}${damaged}`);
		owner.append(
			unwrap(
				normalizeLogRecord(
					{
						timestamp: new Date(),
						level: "info",
						event: "log:info",
						message: "append",
						metadata: {},
					},
					{},
				),
			),
		);
		unwrap(await owner.source.flush(signal));
		const restarted = unwrap(await reader.read({ ...request, maxBytes: 16_384 }));
		expect(restarted.records.map((record) => record.message)).toEqual(["retained"]);
		expect(restarted.gaps).toEqual([]);
	});

	it("verifies acknowledged normal records across streaming windows after restart", async () => {
		const { directory, owner } = await setup();
		for (let index = 0; index < 500; index++) {
			owner.append(
				unwrap(
					normalizeLogRecord(
						{
							timestamp: new Date(),
							level: "info",
							event: "log:info",
							message: `${index}${"x".repeat(500)}`,
							metadata: {},
						},
						{},
					),
				),
			);
		}
		const through = unwrap(await owner.source.flush(signal));
		const reader = unwrap(await owner.source.createReader({ checkpointId: "windows" }, signal));
		let count = 0;
		let reachedThrough = false;
		for (let attempt = 0; attempt < 5 && !reachedThrough; attempt++) {
			const batch = unwrap(await reader.read({ ...request, maxEntries: 1000, through }));
			expect(batch.gaps).toEqual([]);
			count += batch.records.length;
			reachedThrough = batch.reachedThrough;
			unwrap(await reader.ack(batch.receipt, signal));
		}
		expect(count).toBe(501);
		expect(reachedThrough).toBe(true);
		unwrap(await reader.close(signal));
		unwrap(await owner.close(signal));
		const reopened = unwrap(createLogFileSource({ directory }));
		owners.push(reopened);
		const resumed = unwrap(await reopened.source.createReader({ checkpointId: "windows" }, signal));
		const empty = unwrap(await resumed.read(request));
		expect(empty.records).toEqual([]);
		expect(empty.gaps).toEqual([]);
	});

	it("cancels a bounded oversized scan without persisting an interior cursor", async () => {
		const { directory, owner, canonical } = await setup();
		const valid = await readFile(canonical, "utf8");
		await writeFile(canonical, `${"x".repeat(300_000)}\n${valid}`);
		const reader = unwrap(await owner.source.createReader({ checkpointId: "cancel" }, signal));
		const checkpointName = (await readdir(path.join(directory, "checkpoints")))[0];
		if (!checkpointName) throw new Error("Expected a checkpoint");
		const checkpointPath = path.join(directory, "checkpoints", checkpointName);
		const before = await readFile(checkpointPath, "utf8");
		const abort = new AbortController();
		const opened = fsPromises.open;
		vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
			const handle = await opened(...args);
			if (String(args[0]).endsWith(".jsonl")) {
				const read = handle.read.bind(handle);
				vi.spyOn(handle, "read").mockImplementation(
					async (...readArgs: Parameters<typeof handle.read>) => {
						const result = await read(...readArgs);
						abort.abort(new Error("cancel scan"));
						return result;
					},
				);
			}
			return handle;
		});
		const cancelled = await reader.read({ ...request, signal: abort.signal });
		expect(cancelled._unsafeUnwrapErr().message).toBe("cancel scan");
		expect(await readFile(checkpointPath, "utf8")).toBe(before);
		vi.restoreAllMocks();
		const recovered = unwrap(await reader.read(request));
		expect(recovered.records.map((record) => record.message)).toEqual(["retained"]);
		expect(recovered.gaps).toEqual([expect.objectContaining({ reason: "corruption" })]);
		unwrap(await reader.ack(recovered.receipt, signal));
		expect(unwrap(await reader.read(request)).gaps).toEqual([]);
	});
});
