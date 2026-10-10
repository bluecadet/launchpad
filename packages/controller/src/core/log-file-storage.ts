import { createHash, type Hash, randomUUID } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	openSync,
	readdirSync,
	readSync,
	renameSync,
	statSync,
	truncateSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMPTY_CHAIN_HASH, type Segment, segmentFromName } from "./log-file-codec.js";
import { throwIfAborted } from "./log-file-operations.js";

const MAX_LINE_BYTES = 262_145;
type LineRead =
	| { kind: "line"; line: string; bytes: Buffer; nextOffset: number }
	| { kind: "partial"; bytes: Buffer; atEnd: boolean }
	| { kind: "eof" };

/** Persist directory entries on POSIX. Windows does not support opening directories for fsync. */
export function syncDirectorySync(directory: string): void {
	if (process.platform === "win32") return;
	const descriptor = openSync(directory, "r");
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

export async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === "win32") return;
	const handle = await open(directory, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export function syncFileSync(filePath: string): void {
	const descriptor = openSync(filePath, "r+");
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

export async function syncFile(filePath: string): Promise<void> {
	const handle = await open(filePath, "r+");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export function writeJsonAtomicSync(filePath: string, value: unknown): void {
	const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		const descriptor = openSync(temporaryPath, "r+");
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
		renameSync(temporaryPath, filePath);
		syncDirectorySync(path.dirname(filePath));
	} catch (error) {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// The temporary file may not have been created.
		}
		throw error;
	}
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
	const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		const handle = await open(temporaryPath, "r+");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporaryPath, filePath);
		await syncDirectory(path.dirname(filePath));
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

export function listSegmentsSync(directory: string): Segment[] {
	return readdirSync(directory)
		.map((fileName) => segmentFromName(directory, fileName))
		.filter((segment): segment is Segment => segment !== null)
		.sort((left, right) => left.sequence - right.sequence);
}

export async function listSegments(directory: string): Promise<Segment[]> {
	return (await listLogFiles(directory)).segments;
}

/** Include orphaned derived views, but never touch files outside our strict namespace. */
export async function listLogFiles(
	directory: string,
): Promise<{ segments: Segment[]; textSegments: Segment[] }> {
	const segments: Segment[] = [];
	const textSegments: Segment[] = [];
	for (const fileName of await readdir(directory)) {
		const isText = fileName.endsWith(".log");
		const segment = segmentFromName(
			directory,
			isText ? fileName.replace(/\.log$/, ".jsonl") : fileName,
		);
		if (segment) (isText ? textSegments : segments).push(segment);
	}
	segments.sort((left, right) => left.sequence - right.sequence);
	return { segments, textSegments };
}

/** Observe every sibling before propagating failure; none may outlive the directory lease. */
export async function settledValues<T>(operations: readonly Promise<T>[]): Promise<T[]> {
	const results = await Promise.allSettled(operations);
	return results.map((result) => {
		if (result.status === "rejected") throw result.reason;
		return result.value;
	});
}

export function truncateIncompleteTailSync(filePath: string): boolean {
	const size = statSync(filePath).size;
	if (size === 0) return false;
	const descriptor = openSync(filePath, "r");
	try {
		const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size));
		let end = size;
		while (end > 0) {
			const start = Math.max(0, end - buffer.length);
			const length = readSync(descriptor, buffer, 0, end - start, start);
			const newline = buffer.subarray(0, length).lastIndexOf(0x0a);
			if (newline >= 0) {
				const completeSize = start + newline + 1;
				if (completeSize === size) return false;
				truncateSync(filePath, completeSize);
				return true;
			}
			end = start;
		}
		truncateSync(filePath, 0);
		return true;
	} finally {
		closeSync(descriptor);
	}
}

export class SegmentChangedError extends Error {}

/** One bounded window per batch, shared by all sequential lines. No open handle
 * survives a read, so rotation is safe on Windows as well as POSIX. */
function bufferedLines() {
	let cachedPath = "";
	let start = 0;
	let bytes = Buffer.alloc(0);
	let endOfFile = false;
	return async (
		filePath: string,
		offset: number,
		end = Number.MAX_SAFE_INTEGER,
	): Promise<LineRead> => {
		if (offset >= end) return { kind: "eof" };
		if (cachedPath === filePath && endOfFile && offset === start + bytes.length) {
			return { kind: "eof" };
		}
		if (cachedPath !== filePath || offset < start || offset >= start + bytes.length) {
			cachedPath = filePath;
			start = offset;
			bytes = Buffer.alloc(0);
			endOfFile = false;
		}
		let remaining = bytes.subarray(offset - start, Math.min(bytes.length, end - start));
		if (remaining.indexOf(0x0a) < 0 && !endOfFile) {
			// Consume the already loaded suffix before fetching another window;
			// rereading it would spend the caller's byte budget twice.
			if (remaining.length > 0 && offset > start) {
				return { kind: "partial", bytes: remaining, atEnd: false };
			}
			const handle = await open(filePath, "r");
			try {
				const buffer = Buffer.allocUnsafe(Math.min(MAX_LINE_BYTES + 1, end - offset));
				const result = await handle.read(buffer, 0, buffer.length, offset);
				bytes = buffer.subarray(0, result.bytesRead);
				start = offset;
				endOfFile = result.bytesRead < buffer.length;
				remaining = bytes;
			} finally {
				await handle.close();
			}
		}
		if (remaining.length === 0) return { kind: "eof" };
		const newline = remaining.indexOf(0x0a);
		if (newline >= 0) {
			const line = remaining.subarray(0, newline + 1);
			return {
				kind: "line",
				line: line.subarray(0, -1).toString("utf8"),
				bytes: line,
				nextOffset: offset + line.length,
			};
		}
		return {
			kind: "partial",
			bytes: remaining,
			atEnd: endOfFile && offset + remaining.length === start + bytes.length,
		};
	};
}

/** Incomplete scans are memory-only: a receipt never points inside a JSONL line. */
export type LineScan = {
	readonly signature: string;
	readonly nextOffset: number;
	readonly hash: Hash;
};

type BoundedLineRead =
	| { kind: "line"; line: string; bytes: Buffer; nextOffset: number }
	| { kind: "oversized"; nextOffset: number; chainHash: string; consumedBytes: number }
	| { kind: "partial"; consumedBytes: number; atEnd: boolean }
	| { kind: "eof" };

/** Scan large corrupt lines incrementally without allocating the whole line or
 * committing an interior position. The hash uses exactly the same line framing
 * as ordinary records, so acknowledged skips survive prefix verification. */
export function boundedRecordLines(scans: Map<string, LineScan>, signal?: AbortSignal) {
	const readLine = bufferedLines();
	return async (
		filePath: string,
		offset: number,
		previousHash: string,
		signature: string,
		maxBytes: number,
		throughOffset = Number.MAX_SAFE_INTEGER,
	): Promise<BoundedLineRead> => {
		const key = `${filePath}:${offset}:${previousHash}`;
		const cached = scans.get(key);
		const prior = cached?.signature === signature ? cached : undefined;
		let position = prior?.nextOffset ?? offset;
		const hash = prior?.hash.copy() ?? createHash("sha256").update(previousHash);
		let consumedBytes = 0;
		while (consumedBytes < maxBytes && position < throughOffset) {
			if (signal) throwIfAborted(signal);
			const end = Math.min(position + maxBytes - consumedBytes, throughOffset);
			const line = await readLine(filePath, position, end);
			if (signal) throwIfAborted(signal);
			if (line.kind === "eof") {
				return position === offset ? line : { kind: "partial", consumedBytes, atEnd: true };
			}
			hash.update(line.bytes);
			position += line.bytes.length;
			consumedBytes += line.bytes.length;
			if (line.kind === "line") {
				scans.delete(key);
				if (position - offset > MAX_LINE_BYTES) {
					return {
						kind: "oversized",
						nextOffset: position,
						chainHash: hash.digest("hex"),
						consumedBytes,
					};
				}
				// A normal record larger than the caller's byte budget remains
				// unread. A later sufficiently sized request can read it whole.
				if (position - offset !== line.bytes.length) {
					return { kind: "partial", consumedBytes, atEnd: false };
				}
				return line;
			}
			if (scans.size >= 64 && !scans.has(key)) scans.clear();
			scans.set(key, { signature, nextOffset: position, hash: hash.copy() });
			if (line.atEnd) return { kind: "partial", consumedBytes, atEnd: true };
		}
		return { kind: "partial", consumedBytes, atEnd: false };
	};
}

export async function computeChainToOffset(
	segment: Segment,
	offset: number,
	signal?: AbortSignal,
): Promise<string> {
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid log cursor offset");
	const file = await stat(segment.canonicalPath);
	if (offset > file.size) throw new SegmentChangedError("Log source segment was truncated");
	let position = 0;
	let hash = EMPTY_CHAIN_HASH;
	let lineHash = createHash("sha256").update(hash);
	const readLine = bufferedLines();
	while (position < offset) {
		if (signal) throwIfAborted(signal);
		const line = await readLine(segment.canonicalPath, position, offset);
		if (signal) throwIfAborted(signal);
		if (line.kind === "eof") {
			throw new SegmentChangedError("Log source segment identity no longer matches its checkpoint");
		}
		lineHash.update(line.bytes);
		position += line.bytes.length;
		if (line.kind === "line") {
			hash = lineHash.digest("hex");
			lineHash = createHash("sha256").update(hash);
			continue;
		}
		if (line.atEnd || position === offset) {
			throw new SegmentChangedError("Log source segment identity no longer matches its checkpoint");
		}
	}
	return hash;
}

export async function segmentSignature(segment: Segment): Promise<string> {
	const file = await stat(segment.canonicalPath, { bigint: true });
	return `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`;
}
