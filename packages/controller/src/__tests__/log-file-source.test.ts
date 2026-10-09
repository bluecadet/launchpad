import * as fsPromises from "node:fs/promises";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type NormalizedLogRecord,
	normalizeLogRecord,
	type ResourceAttributes,
} from "@bluecadet/launchpad-utils/logging";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
}));

import { createLogFileSource } from "../core/log-file-source.js";

const directories: string[] = [];
const activeSignal = () => new AbortController().signal;

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "launchpad-log-source-"));
	directories.push(directory);
	return directory;
}

const baseResource: ResourceAttributes = {
	"service.name": "launchpad",
	"service.instance.id": "runtime-one",
};

function record(
	message: string,
	resource = baseResource,
	timestamp = new Date("2026-03-01T10:00:00.000Z"),
): NormalizedLogRecord {
	return normalizeLogRecord(
		{
			timestamp,
			level: "info",
			message,
			event: "log:info",
			metadata: { value: message },
		},
		resource,
	);
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("log file source", () => {
	it("appends complete canonical JSONL, reads it through a checkpointed reader, and reopens", async () => {
		const directory = await temporaryDirectory();
		const source = createLogFileSource({
			directory,
		});
		expect(source.append(record("first"), "first human line")).toBe(true);
		expect(source.append(record("second"), "second human line")).toBe(true);
		const barrier = await source.source.flush(activeSignal());
		const reader = await source.source.createReader({ checkpointId: "otlp-main" }, activeSignal());
		const batch = await reader.read({
			maxEntries: 10,
			maxBytes: 1_000_000,
			through: barrier,
			signal: activeSignal(),
		});

		expect(batch.records.map((entry) => entry.message)).toEqual(["first", "second"]);
		expect(batch.records[0]?.timestamp).toEqual(new Date("2026-03-01T10:00:00.000Z"));
		expect(batch.records[0]?.resource).toEqual(baseResource);
		expect(batch.reachedThrough).toBe(true);
		await reader.ack(batch.receipt, activeSignal());
		await reader.close(activeSignal());
		const sourceId = source.source.identity.sourceId;
		await source.close(activeSignal());

		const reopened = createLogFileSource({
			directory,
		});
		expect(reopened.source.identity.sourceId).toBe(sourceId);
		expect(reopened.source.identity.runtimeId).not.toBe(source.source.identity.runtimeId);
		const resumed = await reopened.source.createReader(
			{ checkpointId: "otlp-main" },
			activeSignal(),
		);
		const empty = await resumed.read({
			maxEntries: 10,
			maxBytes: 1_000_000,
			signal: activeSignal(),
		});
		expect(empty.records).toEqual([]);
		await resumed.ack(empty.receipt, activeSignal());
		await resumed.close(activeSignal());
		await reopened.close(activeSignal());

		const files = await readdir(directory);
		const canonicalFiles = files.filter((file) => file.endsWith(".jsonl"));
		const humanFiles = files.filter((file) => file.endsWith(".log"));
		expect(canonicalFiles.length).toBeGreaterThan(0);
		expect(humanFiles.length).toBeGreaterThan(0);
		const canonical = await readFile(path.join(directory, canonicalFiles[0]!), "utf8");
		expect(canonical.endsWith("\n")).toBe(true);
		expect(canonical.trim().split("\n")).toHaveLength(2);
	});

	it("rotates one paired output set by size and UTC day without wall-clock ordering", async () => {
		const directory = await temporaryDirectory();
		let now = new Date("2026-03-01T23:59:00.000Z");
		const source = createLogFileSource({
			directory,
			maxSegmentBytes: 1_024,
			now: () => now.getTime(),
		});
		for (let index = 0; index < 8; index += 1) {
			source.append(record(`sized-${index}-${"x".repeat(250)}`), `sized ${index}`);
		}
		now = new Date("2026-03-02T00:01:00.000Z");
		source.append(record("next-day"), "next day");
		await source.source.flush(activeSignal());
		await source.close(activeSignal());

		const files = await readdir(directory);
		const canonical = files.filter((file) => file.endsWith(".jsonl")).sort();
		const human = files.filter((file) => file.endsWith(".log")).sort();
		expect(canonical.length).toBeGreaterThanOrEqual(3);
		expect(human).toHaveLength(canonical.length);
		expect(canonical.some((file) => file.includes("2026-03-02"))).toBe(true);
	});

	it("never advances over an active partial line and reports an abandoned malformed tail after reopen", async () => {
		const directory = await temporaryDirectory();
		const first = createLogFileSource({ directory });
		first.append(record("complete"));
		await first.source.flush(activeSignal());
		await first.close(activeSignal());
		const canonical = (await readdir(directory)).find((file) => file.endsWith(".jsonl"));
		expect(canonical).toBeDefined();
		const abandonedActive = canonical!.replace(".sealed.jsonl", ".active.jsonl");
		await rename(path.join(directory, canonical!), path.join(directory, abandonedActive));
		await writeFile(path.join(directory, abandonedActive), "{malformed", { flag: "a" });

		const reopened = createLogFileSource({ directory });
		const reader = await reopened.source.createReader({ checkpointId: "partial" }, activeSignal());
		const batch = await reader.read({
			maxEntries: 10,
			maxBytes: 1_000_000,
			signal: activeSignal(),
		});
		expect(batch.records.map((entry) => entry.message)).toEqual(["complete"]);
		expect(batch.gaps).toEqual([
			expect.objectContaining({ reason: "truncation", lostRecords: null }),
		]);
		await reader.ack(batch.receipt, activeSignal());
		await reader.close(activeSignal());
		await reopened.close(activeSignal());
	});

	it("rejects corrupt source metadata but recovers truncated checkpointed segments", async () => {
		const directory = await temporaryDirectory();
		const source = createLogFileSource({ directory });
		source.append(record("one"));
		await source.source.flush(activeSignal());
		const reader = await source.source.createReader({ checkpointId: "truncate" }, activeSignal());
		const batch = await reader.read({ maxEntries: 1, maxBytes: 1_000_000, signal: activeSignal() });
		await reader.ack(batch.receipt, activeSignal());
		await reader.close(activeSignal());
		await source.close(activeSignal());

		const canonical = (await readdir(directory)).find((file) => file.endsWith(".jsonl"));
		await truncate(path.join(directory, canonical!), 0);
		const reopened = createLogFileSource({ directory });
		const truncatedReader = await reopened.source.createReader(
			{ checkpointId: "truncate" },
			activeSignal(),
		);
		const recovered = await truncatedReader.read({
			maxEntries: 10,
			maxBytes: 1_000_000,
			signal: activeSignal(),
		});
		expect(recovered.gaps).toContainEqual(
			expect.objectContaining({ reason: "truncation", lostRecords: null }),
		);
		await truncatedReader.ack(recovered.receipt, activeSignal());
		await truncatedReader.close(activeSignal());
		await reopened.close(activeSignal());

		await writeFile(path.join(directory, "feed.json"), "{bad", "utf8");
		expect(() => createLogFileSource({ directory })).toThrow(/metadata/i);
	});

	it.each(["{bad", "{}"])(
		"replays oldest retained records when checkpoint is corrupt: %s",
		async (corrupt) => {
			const directory = await temporaryDirectory();
			const first = createLogFileSource({ directory });
			first.append(record("replayed"));
			await first.source.flush(activeSignal());
			const originalReader = await first.source.createReader(
				{ checkpointId: "corrupt" },
				activeSignal(),
			);
			const originalBatch = await originalReader.read({
				maxEntries: 10,
				maxBytes: 1_000_000,
				signal: activeSignal(),
			});
			await originalReader.ack(originalBatch.receipt, activeSignal());
			await originalReader.close(activeSignal());
			await first.close(activeSignal());
			const checkpointDirectory = path.join(directory, "checkpoints");
			const checkpoint = (await readdir(checkpointDirectory))[0];
			if (!checkpoint) throw new Error("Expected a reader checkpoint");
			await writeFile(path.join(checkpointDirectory, checkpoint), corrupt, "utf8");

			const reopened = createLogFileSource({ directory });
			const reader = await reopened.source.createReader(
				{ checkpointId: "corrupt" },
				activeSignal(),
			);
			const batch = await reader.read({
				maxEntries: 10,
				maxBytes: 1_000_000,
				signal: activeSignal(),
			});
			expect(batch.records.map((entry) => entry.message)).toEqual(["replayed"]);
			expect(batch.gaps).toContainEqual(
				expect.objectContaining({ reason: "corruption", lostRecords: null }),
			);
			await reader.ack(batch.receipt, activeSignal());
			await reader.close(activeSignal());
			await reopened.close(activeSignal());
		},
	);

	it("reports retention loss even when every sealed backlog segment was deleted", async () => {
		const directory = await temporaryDirectory();
		const source = createLogFileSource({
			directory,
			maxSegmentBytes: 1_024,
			maxBytes: 1_024,
		});
		for (let index = 0; index < 12; index += 1)
			source.append(record(`old-${index}-${"x".repeat(300)}`));
		await source.source.flush(activeSignal());
		const reader = await source.source.createReader({ checkpointId: "late" }, activeSignal());
		const batch = await reader.read({
			maxEntries: 100,
			maxBytes: 1_000_000,
			signal: activeSignal(),
		});
		expect(
			batch.gaps.some((gap) => gap.reason === "retention" && /unknown/i.test(gap.detail)),
		).toBe(true);
		await reader.ack(batch.receipt, activeSignal());
		await reader.close(activeSignal());
		await source.close(activeSignal());
	});

	it("enforces one native owner per permanent lock-file identity", async () => {
		const directory = await temporaryDirectory();
		const first = createLogFileSource({ directory });
		expect(() => createLogFileSource({ directory })).toThrow(/already owned/i);
		expect(await readdir(directory)).toContain(".launchpad-log.lock");
		await first.close(activeSignal());
		expect(await readdir(directory)).toContain(".launchpad-log.lock");

		const next = createLogFileSource({ directory });
		await next.close(activeSignal());
	});

	it("persists first reader enrollment before any record is sent or acknowledged", async () => {
		const directory = await temporaryDirectory();
		const source = createLogFileSource({ directory });
		const reader = await source.source.createReader(
			{ checkpointId: "first-enrollment" },
			activeSignal(),
		);
		const checkpointFiles = await readdir(path.join(directory, "checkpoints"));
		expect(checkpointFiles).toHaveLength(1);
		const checkpointFile = checkpointFiles[0];
		if (!checkpointFile) throw new Error("Expected enrollment checkpoint");
		const checkpoint = await readFile(path.join(directory, "checkpoints", checkpointFile), "utf8");
		expect(checkpoint).toContain("first-enrollment");
		await reader.close(activeSignal());
		await source.close(activeSignal());
	});

	it("requires one outstanding receipt and rejects stale acknowledgements", async () => {
		const source = createLogFileSource({ directory: await temporaryDirectory() });
		source.append(record("receipt"));
		await source.source.flush(activeSignal());
		const reader = await source.source.createReader({ checkpointId: "receipt" }, activeSignal());
		const batch = await reader.read({ maxEntries: 1, maxBytes: 1_000_000, signal: activeSignal() });
		await expect(
			reader.read({ maxEntries: 1, maxBytes: 1_000_000, signal: activeSignal() }),
		).rejects.toThrow(/outstanding/i);
		await expect(reader.ack("forged", activeSignal())).rejects.toThrow(/stale|invalid/i);
		await reader.ack(batch.receipt, activeSignal());
		await expect(reader.ack(batch.receipt, activeSignal())).rejects.toThrow(/stale|invalid/i);
		await reader.close(activeSignal());
		await source.close(activeSignal());
	});

	it("rejects all new owner I/O after close even after a successor acquires the lease", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory });
		const reader = await owner.source.createReader({ checkpointId: "closed" }, activeSignal());
		const batch = await reader.read({ maxEntries: 10, maxBytes: 1000000, signal: activeSignal() });
		await owner.close(activeSignal());
		const successor = createLogFileSource({ directory });
		await expect(reader.ack(batch.receipt, activeSignal())).rejects.toThrow(/closing/);
		await expect(owner.source.flush(activeSignal())).rejects.toThrow(/closing/);
		await expect(
			owner.source.createReader({ checkpointId: "new" }, activeSignal()),
		).rejects.toThrow(/closing/);
		await successor.close(activeSignal());
	});

	it("preserves an acknowledged empty EOF across restart", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory });
		const reader = await owner.source.createReader({ checkpointId: "empty" }, activeSignal());
		const batch = await reader.read({ maxEntries: 10, maxBytes: 1000000, signal: activeSignal() });
		await reader.ack(batch.receipt, activeSignal());
		await owner.close(activeSignal());
		const successor = createLogFileSource({ directory });
		const resumed = await successor.source.createReader({ checkpointId: "empty" }, activeSignal());
		const empty = await resumed.read({ maxEntries: 10, maxBytes: 1000000, signal: activeSignal() });
		expect(empty.records).toEqual([]);
		expect(empty.gaps).toEqual([]);
		await successor.close(activeSignal());
	});

	it("does not consume beyond an already acknowledged through barrier", async () => {
		const owner = createLogFileSource({ directory: await temporaryDirectory() });
		owner.append(record("before"));
		const through = await owner.source.flush(activeSignal());
		const reader = await owner.source.createReader({ checkpointId: "through" }, activeSignal());
		const request = { maxEntries: 10, maxBytes: 1000000, signal: activeSignal(), through };
		const first = await reader.read(request);
		await reader.ack(first.receipt, activeSignal());
		owner.append(record("after"));
		await owner.source.flush(activeSignal());
		const second = await reader.read(request);
		expect(second.records).toEqual([]);
		expect(second.reachedThrough).toBe(true);
		await owner.close(activeSignal());
	});

	it("buffers sequential records and avoids prefix reads and checkpoint writes at idle EOF", async () => {
		const owner = createLogFileSource({ directory: await temporaryDirectory() });
		for (let index = 0; index < 100; index++) owner.append(record(`line-${index}`));
		await owner.source.flush(activeSignal());
		const reader = await owner.source.createReader({ checkpointId: "idle" }, activeSignal());
		const opens = vi.spyOn(fsPromises, "open");
		const writes = vi.spyOn(fsPromises, "writeFile");
		const request = { maxEntries: 1000, maxBytes: 1000000, signal: activeSignal() };
		const first = await reader.read(request);
		expect(first.records).toHaveLength(100);
		expect(opens.mock.calls.length).toBeLessThan(5);
		await reader.ack(first.receipt, activeSignal());
		opens.mockClear();
		writes.mockClear();
		for (let index = 0; index < 3; index++) {
			const empty = await reader.read(request);
			await reader.ack(empty.receipt, activeSignal());
		}
		expect(opens.mock.calls.length).toBeLessThan(5);
		expect(writes).not.toHaveBeenCalled();
		await owner.close(activeSignal());
	});

	it("persists retention intent before destructive unlink", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory, maxSegmentBytes: 1024, maxBytes: 1024 });
		const generations: number[] = [];
		const remove = fsPromises.rm;
		vi.spyOn(fsPromises, "rm").mockImplementation(async (target, options) => {
			if (String(target).endsWith(".sealed.jsonl")) {
				const metadata: { retentionGeneration: number } = JSON.parse(
					await readFile(path.join(directory, "feed.json"), "utf8"),
				);
				generations.push(metadata.retentionGeneration);
			}
			return remove(target, options);
		});
		for (let index = 0; index < 4; index++) owner.append(record("x".repeat(400)));
		await owner.source.flush(activeSignal());
		expect(generations.length).toBeGreaterThan(0);
		expect(generations[0]).toBeGreaterThan(0);
		await owner.close(activeSignal());
	});

	it("serializes a paused read with rotation and reserves concurrent reader operations", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory, maxSegmentBytes: 1024 });
		owner.append(record("a".repeat(400)));
		await owner.source.flush(activeSignal());
		const reader = await owner.source.createReader({ checkpointId: "rotation" }, activeSignal());
		const realOpen = fsPromises.open;
		let resume = () => {};
		const paused = new Promise<void>((resolve) => {
			resume = resolve;
		});
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
			if (String(args[0]).endsWith(".active.jsonl")) {
				entered();
				await paused;
			}
			return realOpen(...args);
		});
		const request = { maxEntries: 10, maxBytes: 1000000, signal: activeSignal() };
		const pending = reader.read(request);
		await started;
		owner.append(record("b".repeat(400)));
		const duplicate = reader.read(request);
		resume();
		await expect(duplicate).rejects.toThrow(/outstanding|progress/);
		const batch = await pending;
		expect(batch.records).toHaveLength(1);
		await owner.source.flush(activeSignal());
		await reader.ack(batch.receipt, activeSignal());
		await owner.close(activeSignal());
	});

	it("keeps the lease until an aborted acknowledgement finishes its underlying I/O", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory });
		owner.append(record("pending ack"));
		await owner.source.flush(activeSignal());
		const reader = await owner.source.createReader({ checkpointId: "pending" }, activeSignal());
		const batch = await reader.read({ maxEntries: 10, maxBytes: 1000000, signal: activeSignal() });
		const realWrite = fsPromises.writeFile;
		let resume = () => {};
		const paused = new Promise<void>((resolve) => {
			resume = resolve;
		});
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		vi.spyOn(fsPromises, "writeFile").mockImplementation(async (...args) => {
			if (String(args[0]).includes("reader-")) {
				entered();
				await paused;
			}
			return realWrite(...args);
		});
		const abortAck = new AbortController();
		const pending = reader.ack(batch.receipt, abortAck.signal);
		await started;
		const rejected = expect(pending).rejects.toThrow();
		abortAck.abort();
		await rejected;
		const abortClose = new AbortController();
		abortClose.abort();
		await expect(owner.close(abortClose.signal)).rejects.toThrow();
		expect(() => createLogFileSource({ directory })).toThrow(/owned/);
		resume();
		await owner.close(activeSignal());
		const successor = createLogFileSource({ directory });
		await expect(reader.ack(batch.receipt, activeSignal())).rejects.toThrow(/closing/);
		await successor.close(activeSignal());
	});

	it("observes deferred cleanup failures after a pre-aborted close without releasing its lease early", async () => {
		const directory = await temporaryDirectory();
		const diagnostic = vi.fn();
		const owner = createLogFileSource({ directory, onDiagnostic: diagnostic });
		const failure = new Error("deferred close open failure");
		const cancellation = new Error("close cancelled");
		const realOpen = fsPromises.open;
		let resume = () => {};
		const paused = new Promise<void>((resolve) => {
			resume = resolve;
		});
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const openSpy = vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
			if (String(args[0]).endsWith(".active.jsonl")) {
				entered();
				await paused;
				throw failure;
			}
			return realOpen(...args);
		});
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			await expect(owner.close(AbortSignal.abort(cancellation))).rejects.toBe(cancellation);
			await started;
			expect(() => createLogFileSource({ directory })).toThrow(/owned/);
			resume();
			// Let Node report any orphaned rejection before observing close again.
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(unhandled).not.toHaveBeenCalled();
			expect(owner.source.status.available).toBe(false);
			expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining(failure.message));
			await expect(owner.close(activeSignal())).rejects.toBe(failure);
			openSpy.mockRestore();
			const successor = createLogFileSource({ directory });
			await successor.close(activeSignal());
		} finally {
			resume();
			process.off("unhandledRejection", unhandled);
		}
	});

	it("detects same-UUID truncate/regrow after prefix caching and recovers with an unknown-loss gap", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory });
		owner.append(record("original"));
		await owner.source.flush(activeSignal());
		const reader = await owner.source.createReader({ checkpointId: "regrow" }, activeSignal());
		const request = { maxEntries: 10, maxBytes: 1000000, signal: activeSignal() };
		const first = await reader.read(request);
		await reader.ack(first.receipt, activeSignal());
		const file = (await readdir(directory)).find((name) => name.endsWith(".active.jsonl"));
		if (!file) throw new Error("Missing active file");
		const content = await readFile(path.join(directory, file), "utf8");
		await writeFile(path.join(directory, file), content.replaceAll("original", "replaced"));
		const replay = await reader.read(request);
		expect(replay.records.map((entry) => entry.message)).toEqual(["replaced"]);
		expect(replay.gaps).toContainEqual(
			expect.objectContaining({ reason: "truncation", lostRecords: null }),
		);
		await reader.ack(replay.receipt, activeSignal());
		const empty = await reader.read(request);
		expect(empty.gaps).toEqual([]);
		await owner.close(activeSignal());
	});

	it("reserves a checkpoint identity before reader enrollment awaits I/O", async () => {
		const owner = createLogFileSource({ directory: await temporaryDirectory() });
		const first = owner.source.createReader({ checkpointId: "duplicate" }, activeSignal());
		await expect(
			owner.source.createReader({ checkpointId: "duplicate" }, activeSignal()),
		).rejects.toThrow(/already open/);
		await (await first).close(activeSignal());
		await owner.close(activeSignal());
	});

	it("bounds the byte window without mistaking a budget-limited sealed line for corruption", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory });
		owner.append(record("bounded"));
		await owner.close(activeSignal());
		const reopened = createLogFileSource({ directory });
		const reader = await reopened.source.createReader(
			{ checkpointId: "byte-window" },
			activeSignal(),
		);
		const realOpen = fsPromises.open;
		const lengths: number[] = [];
		vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
			const handle = await realOpen(...args);
			if (String(args[0]).endsWith(".jsonl")) {
				const originalRead = handle.read.bind(handle);
				vi.spyOn(handle, "read").mockImplementation(
					async (...readArgs: Parameters<typeof handle.read>) => {
						const buffer = readArgs[0];
						if (Buffer.isBuffer(buffer)) lengths.push(buffer.length);
						return originalRead(...readArgs);
					},
				);
			}
			return handle;
		});
		const batch = await reader.read({ maxEntries: 10, maxBytes: 1, signal: activeSignal() });
		expect(batch.records).toEqual([]);
		expect(batch.gaps).toEqual([]);
		expect(lengths).toEqual([1]);
		await reader.ack(batch.receipt, activeSignal());
		await reopened.close(activeSignal());
	});

	it("bounds admission and diagnoses asynchronous I/O loss without a memory fallback", async () => {
		const diagnostic = vi.fn();
		const directory = await temporaryDirectory();
		const source = createLogFileSource({
			directory,
			maxPendingRecords: 2,
			onDiagnostic: diagnostic,
		});
		const activeFile = (await readdir(directory)).find((file) => file.endsWith(".active.jsonl"));
		if (!activeFile) throw new Error("Expected an active canonical file");
		await rm(path.join(directory, activeFile));
		await mkdir(path.join(directory, activeFile));
		expect(source.append(record("one"))).toBe(true);
		expect(source.append(record("two"))).toBe(true);
		expect(source.append(record("three"))).toBe(false);
		await source.source.flush(activeSignal());
		expect(source.source.status.droppedRecords).toBe(3);
		expect(source.source.status.pendingRecords).toBe(0);
		expect(source.source.status.lossEvents).toBe(2);
		expect(diagnostic).toHaveBeenCalled();
		await source.close(activeSignal());
	});
});
