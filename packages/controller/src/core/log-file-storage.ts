import { randomUUID } from "node:crypto";
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
import { chainHash, EMPTY_CHAIN_HASH, type Segment, segmentFromName } from "./log-file-codec.js";

const MAX_LINE_BYTES = 262_145;
type LineRead =
	| { kind: "line"; line: string; bytes: Buffer; nextOffset: number }
	| { kind: "partial"; bytes: number }
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
export function bufferedLines() {
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
		if (cachedPath !== filePath || offset < start || offset >= start + bytes.length) {
			cachedPath = filePath;
			start = offset;
			bytes = Buffer.alloc(0);
			endOfFile = false;
		}
		let remaining = bytes.subarray(offset - start, Math.min(bytes.length, end - start));
		if (remaining.indexOf(0x0a) < 0 && !endOfFile) {
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
		if (remaining.length <= MAX_LINE_BYTES) return { kind: "partial", bytes: remaining.length };
		// Do not scan an arbitrarily large malformed file searching for a newline.
		return {
			kind: "line",
			line: "",
			bytes: Buffer.alloc(0),
			nextOffset: offset + remaining.length,
		};
	};
}

export async function computeChainToOffset(segment: Segment, offset: number): Promise<string> {
	if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid log cursor offset");
	const file = await stat(segment.canonicalPath);
	if (offset > file.size) throw new SegmentChangedError("Log source segment was truncated");
	let position = 0;
	let hash = EMPTY_CHAIN_HASH;
	const readLine = bufferedLines();
	while (position < offset) {
		const line = await readLine(segment.canonicalPath, position, offset);
		if (line.kind !== "line" || line.nextOffset > offset || line.bytes.length === 0) {
			throw new SegmentChangedError("Log source segment identity no longer matches its checkpoint");
		}
		hash = chainHash(hash, line.bytes);
		position = line.nextOffset;
	}
	return hash;
}

export async function segmentSignature(segment: Segment): Promise<string> {
	const file = await stat(segment.canonicalPath, { bigint: true });
	return `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`;
}
