import * as fsPromises from "node:fs/promises";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeLogRecord } from "@bluecadet/launchpad-utils/logging";
import { ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const signal = () => new AbortController().signal;
const request = () => ({ maxEntries: 100, maxBytes: 1_000_000, signal: signal() });
const day = 24 * 60 * 60 * 1000;

async function directory(): Promise<string> {
	const result = await mkdtemp(path.join(tmpdir(), "launchpad-log-regression-"));
	directories.push(result);
	return result;
}

function owner(options: Parameters<typeof createLogFileSource>[0]): LogFileSourceOwner {
	const result = unwrap(createLogFileSource(options));
	owners.push(result);
	return result;
}

function record(message: string) {
	return unwrap(
		normalizeLogRecord(
			{ timestamp: new Date(), level: "info", event: "log:info", message, metadata: {} },
			{},
		),
	);
}

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

afterEach(async () => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const source of owners.splice(0)) await source.close(signal());
	await Promise.all(
		directories.splice(0).map((value) => rm(value, { recursive: true, force: true })),
	);
});

describe("canonical source boundaries", () => {
	it("returns typed factory and async errors without throwing or rejecting", async () => {
		const location = await directory();
		expect(() => createLogFileSource({ directory: location, maxSegmentBytes: 0 })).not.toThrow();
		expect(createLogFileSource({ directory: location, maxSegmentBytes: 0 }).isErr()).toBe(true);
		const source = owner({ directory: location });
		expect(createLogFileSource({ directory: location }).isErr()).toBe(true);
		const cancelled = new Error("cancelled");
		const aborted = AbortSignal.abort(cancelled);
		expect(source.source.flush(aborted)).toBeInstanceOf(ResultAsync);
		expect((await source.source.flush(aborted))._unsafeUnwrapErr()).toBe(cancelled);
		expect((await source.source.createReader({ checkpointId: "bad/id" }, signal())).isErr()).toBe(
			true,
		);
		const reader = unwrap(await source.source.createReader({ checkpointId: "public" }, signal()));
		expect((await reader.read({ ...request(), maxEntries: 0 })).isErr()).toBe(true);
		expect((await reader.ack("invalid", signal())).isErr()).toBe(true);
		expect((await reader.close(aborted))._unsafeUnwrapErr()).toBe(cancelled);
		unwrap(await reader.close(signal()));
		expect((await reader.read(request())).isErr()).toBe(true);
		expect((await source.close(aborted))._unsafeUnwrapErr()).toBe(cancelled);
		unwrap(await source.close(signal()));
		expect((await source.source.flush(signal())).isErr()).toBe(true);
	});

	it("persists all three canonical records when only optional text appends fail", async () => {
		const location = await directory();
		const diagnostic = vi.fn();
		const source = owner({ directory: location, onDiagnostic: diagnostic });
		const append = fsPromises.appendFile;
		vi.spyOn(fsPromises, "appendFile").mockImplementation(async (...args) => {
			if (String(args[0]).endsWith(".log")) throw new Error("text unavailable");
			return append(...args);
		});
		for (const message of ["one", "two", "three"])
			expect(source.append(record(message), message)).toBe(true);
		unwrap(await source.source.flush(signal()));
		expect(source.source.status).toMatchObject({
			available: true,
			pendingRecords: 0,
			droppedRecords: 0,
			lossEvents: 0,
		});
		unwrap(await source.close(signal()));
		const reopened = owner({ directory: location });
		const reader = unwrap(await reopened.source.createReader({ checkpointId: "text" }, signal()));
		const batch = unwrap(await reader.read(request()));
		expect(batch.records.map((entry) => entry.message)).toEqual(["one", "two", "three"]);
		expect(batch.gaps).toEqual([]);
		expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("text unavailable"));
	});

	it("round-trips prototype-like user keys through write/read/ack and restart", async () => {
		const location = await directory();
		const metadata = JSON.parse(
			'{"constructor":{"prototype":{"__proto__":{"value":"kept"}}},"prototype":"metadata","__proto__":"ordinary key"}',
		);
		const resource = JSON.parse('{"constructor":"resource","prototype":true,"__proto__":42}');
		const source = owner({ directory: location });
		const normalized = unwrap(
			normalizeLogRecord(
				{ timestamp: new Date(), level: "info", event: "log:info", message: "keys", metadata },
				resource,
			),
		);
		expect(source.append(normalized)).toBe(true);
		unwrap(await source.source.flush(signal()));
		const reader = unwrap(await source.source.createReader({ checkpointId: "keys" }, signal()));
		const batch = unwrap(await reader.read(request()));
		expect(batch.gaps).toEqual([]);
		expect(batch.records[0]?.metadata).toEqual(metadata);
		expect(batch.records[0]?.resource).toEqual(resource);
		unwrap(await reader.ack(batch.receipt, signal()));
		unwrap(await source.close(signal()));
		const reopened = owner({ directory: location });
		const resumed = unwrap(await reopened.source.createReader({ checkpointId: "keys" }, signal()));
		expect(unwrap(await resumed.read(request())).records).toEqual([]);
		const backfill = unwrap(
			await reopened.source.createReader({ checkpointId: "new-reader" }, signal()),
		);
		expect(unwrap(await backfill.read(request())).records[0]?.metadata).toEqual(metadata);
	});

	it("places a flush barrier ahead of later admissions and syncs rotated files before sealing", async () => {
		const source = owner({ directory: await directory(), maxSegmentBytes: 1024 });
		const opened = fsPromises.open;
		const synced = new Set<string>();
		vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
			const handle = await opened(...args);
			const sync = handle.sync.bind(handle);
			vi.spyOn(handle, "sync").mockImplementation(async () => {
				await sync();
				synced.add(String(args[0]));
			});
			return handle;
		});
		const rename = fsPromises.rename;
		vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
			if (String(from).endsWith(".active.jsonl")) expect(synced.has(String(from))).toBe(true);
			return rename(from, to);
		});
		source.append(record(`first${"x".repeat(700)}`));
		source.append(record(`second${"x".repeat(700)}`));
		const barrier = source.source.flush(signal());
		for (let index = 0; index < 20; index++) source.append(record(`later-${index}`));
		const through = unwrap(await barrier);
		const reader = unwrap(await source.source.createReader({ checkpointId: "barrier" }, signal()));
		const batch = unwrap(await reader.read({ ...request(), through }));
		expect(batch.records).toHaveLength(2);
		expect(batch.reachedThrough).toBe(true);
	});
});

describe("serialized age maintenance", () => {
	it("expires downtime backlog before enrolling a reader", async () => {
		let now = Date.parse("2026-01-01T00:00:00Z");
		const location = await directory();
		const first = owner({ directory: location, maxAgeMs: day, now: () => now });
		first.append(record("expired"), "expired");
		unwrap(await first.close(signal()));
		now += 3 * day;
		const reopened = owner({ directory: location, maxAgeMs: day, now: () => now });
		const reader = unwrap(
			await reopened.source.createReader({ checkpointId: "after-downtime" }, signal()),
		);
		const batch = unwrap(await reader.read(request()));
		expect(batch.records).toEqual([]);
		expect(batch.gaps).toContainEqual(expect.objectContaining({ reason: "retention" }));
		expect((await readdir(location)).some((name) => name.endsWith(".sealed.jsonl"))).toBe(false);
	});

	it("seals and expires a nonempty active segment without new writes or enrollment", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		let now = Date.parse("2026-01-01T00:00:00Z");
		const location = await directory();
		const source = owner({ directory: location, maxAgeMs: day, now: () => now });
		source.append(record("idle"), "idle");
		unwrap(await source.source.flush(signal()));
		const original = (await readdir(location)).find((name) => name.endsWith(".active.jsonl"));
		now += 2 * day;
		await vi.advanceTimersByTimeAsync(60_000);
		unwrap(await source.source.flush(signal()));
		const files = await readdir(location);
		expect(files).not.toContain(original);
		expect(files.filter((name) => name.endsWith(".jsonl"))).toHaveLength(1);
		expect(files.filter((name) => name.endsWith(".log"))).toHaveLength(0);
		unwrap(await source.close(signal()));
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rediscovers orphan text after transient rename and delete failures", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		let now = Date.parse("2026-01-01T00:00:00Z");
		const location = await directory();
		const diagnostic = vi.fn();
		const source = owner({
			directory: location,
			maxAgeMs: day,
			now: () => now,
			onDiagnostic: diagnostic,
		});
		source.append(record("orphan"), "orphan");
		unwrap(await source.source.flush(signal()));
		await writeFile(path.join(location, "unrelated.log"), "keep");
		const rename = fsPromises.rename;
		const remove = fsPromises.rm;
		let failText = true;
		vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
			if (failText && String(from).endsWith(".log")) throw new Error("text rename busy");
			return rename(from, to);
		});
		vi.spyOn(fsPromises, "rm").mockImplementation(async (...args) => {
			if (failText && String(args[0]).endsWith(".log")) throw new Error("text unlink busy");
			return remove(...args);
		});
		now += 2 * day;
		await vi.advanceTimersByTimeAsync(60_000);
		unwrap(await source.source.flush(signal()));
		expect((await readdir(location)).filter((name) => name.endsWith(".log"))).toHaveLength(2);
		expect(source.source.status).toMatchObject({ available: true, droppedRecords: 0 });
		failText = false;
		await vi.advanceTimersByTimeAsync(60_000);
		unwrap(await source.source.flush(signal()));
		expect((await readdir(location)).filter((name) => name.endsWith(".log"))).toEqual([
			"unrelated.log",
		]);
		expect(await readFile(path.join(location, "unrelated.log"), "utf8")).toBe("keep");
		expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("text rename busy"));
		expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("text unlink busy"));
	});

	it("keeps failed-rename text in the byte budget", async () => {
		const location = await directory();
		const source = owner({ directory: location, maxSegmentBytes: 1024, maxBytes: 2000 });
		source.append(record(`first${"x".repeat(700)}`), "human".repeat(1000));
		unwrap(await source.source.flush(signal()));
		const rename = fsPromises.rename;
		vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
			if (String(from).endsWith(".log")) throw new Error("text rename busy");
			return rename(from, to);
		});
		source.append(record(`second${"x".repeat(700)}`));
		unwrap(await source.source.flush(signal()));
		const reader = unwrap(await source.source.createReader({ checkpointId: "budget" }, signal()));
		const batch = unwrap(await reader.read(request()));
		expect(batch.records).toHaveLength(1);
		expect(batch.records[0]?.message).toMatch(/^second/);
		expect(batch.gaps).toContainEqual(expect.objectContaining({ reason: "retention" }));
		expect((await readdir(location)).filter((name) => name.endsWith(".log"))).toEqual([]);
	});
});

describe("physical operation ownership", () => {
	it("bounds reader close waits but reserves identity until queued I/O and close settle", async () => {
		const source = owner({ directory: await directory() });
		source.append(record("pending"));
		unwrap(await source.source.flush(signal()));
		const reader = unwrap(await source.source.createReader({ checkpointId: "same" }, signal()));
		const batch = unwrap(await reader.read(request()));
		const entered = deferred();
		const resume = deferred();
		const write = fsPromises.writeFile;
		vi.spyOn(fsPromises, "writeFile").mockImplementation(async (...args) => {
			if (String(args[0]).includes("reader-")) {
				entered.resolve();
				await resume.promise;
			}
			return write(...args);
		});
		const ack = reader.ack(batch.receipt, signal());
		await entered.promise;
		const abort = new AbortController();
		const closing = reader.close(abort.signal);
		abort.abort(new Error("stop waiting"));
		expect((await closing)._unsafeUnwrapErr().message).toBe("stop waiting");
		let secondSettled = false;
		const second = Promise.resolve(reader.close(signal())).then((result) => {
			secondSettled = true;
			return result;
		});
		await Promise.resolve();
		expect(secondSettled).toBe(false);
		expect((await source.source.createReader({ checkpointId: "same" }, signal())).isErr()).toBe(
			true,
		);
		resume.resolve();
		unwrap(await ack);
		unwrap(await second);
		unwrap(await source.source.createReader({ checkpointId: "same" }, signal()));
	});

	it("waits for blocked stat siblings after a failure and never accumulates maintenance", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const location = await directory();
		const source = owner({ directory: location, maxSegmentBytes: 1024 });
		source.append(record("a".repeat(700)));
		source.append(record("b".repeat(700)));
		unwrap(await source.source.flush(signal()));
		const entered = deferred();
		const resume = deferred();
		const stat = fsPromises.stat;
		let blocked = 0;
		vi.spyOn(fsPromises, "stat").mockImplementation(async (...args) => {
			if (String(args[0]).endsWith(".sealed.jsonl")) throw new Error("stat failed");
			if (String(args[0]).endsWith(".active.jsonl")) {
				blocked++;
				entered.resolve();
				await resume.promise;
			}
			return stat(...args);
		});
		await vi.advanceTimersByTimeAsync(60_000);
		await entered.promise;
		await vi.advanceTimersByTimeAsync(600_000);
		expect(blocked).toBe(1);
		const abort = new AbortController();
		const closing = source.close(abort.signal);
		abort.abort();
		expect((await closing).isErr()).toBe(true);
		expect(createLogFileSource({ directory: location }).isErr()).toBe(true);
		resume.resolve();
		await source.close(signal());
		expect(vi.getTimerCount()).toBe(0);
		vi.restoreAllMocks();
		owner({ directory: location });
	});
});
