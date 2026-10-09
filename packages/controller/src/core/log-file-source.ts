import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	renameSync,
	statSync,
	truncateSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { appendFile, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type LoggerSource,
	type LoggerSourceReader,
	type LoggerSourceStatus,
	type LogReadReceipt,
	type LogSourceBarrier,
	type LogSourceBatch,
	type LogSourceGap,
	type LogSourceReadRequest,
	type NormalizedLogRecord,
	parseLogRecord,
	type ResourceAttributes,
	serializeLogRecord,
} from "@bluecadet/launchpad-utils/logging";
import { acquireLogDirectoryLock, type LogDirectoryLock } from "./log-file-lock.js";

const FORMAT_VERSION = 1;
const DEFAULT_SEGMENT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 28 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_PENDING_RECORDS = 2_048;
const MAX_READ_ENTRIES = 10_000;
const MAX_READ_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 262_145;
const EMPTY_CHAIN_HASH = createHash("sha256").update("launchpad-log-segment-v1").digest("hex");
const SEGMENT_PATTERN =
	/^launchpad-(\d{16})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(\d{4}-\d{2}-\d{2})\.(active|sealed)\.jsonl$/;
const CHECKPOINT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FORBIDDEN_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export interface LogFileSourceOptions {
	readonly directory: string;
	readonly maxSegmentBytes?: number;
	readonly maxBytes?: number;
	readonly maxAgeMs?: number;
	readonly maxPendingRecords?: number;
	readonly now?: () => number;
	readonly onDiagnostic?: (message: string) => void;
}

export interface LogFileSourceOwner {
	readonly source: LoggerSource;
	append(record: NormalizedLogRecord, textLine?: string): boolean;
	close(signal: AbortSignal): Promise<void>;
}

type FeedMetadata = {
	formatVersion: 1;
	sourceId: string;
	nextSegmentSequence: number;
	retentionGeneration: number;
	truncationGeneration: number;
};

type Segment = {
	sequence: number;
	id: string;
	date: string;
	state: "active" | "sealed";
	canonicalPath: string;
	textPath: string;
};

type Cursor = {
	formatVersion: 1;
	sourceId: string;
	segmentSequence: number;
	segmentId: string;
	offset: number;
	chainHash: string;
	seenRetentionGeneration: number;
	seenTruncationGeneration: number;
};

type PendingRecord = {
	canonicalLine: string;
	textLine?: string;
};

type MutableStatus = {
	available: boolean;
	pendingRecords: number;
	droppedRecords: number;
	lossEvents: number;
	lastError?: string;
};

type LineRead =
	| { kind: "line"; line: string; bytes: Buffer; nextOffset: number }
	| { kind: "partial"; bytes: number }
	| { kind: "eof" };

function safeInteger(value: number | undefined, fallback: number, minimum = 1): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`Expected a safe integer greater than or equal to ${minimum}`);
	}
	return value;
}

function exactObject(
	value: unknown,
	keys: readonly string[],
	label: string,
): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid ${label}`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error(`Invalid ${label}`);
	const candidate = value as Record<string, unknown>;
	const actualKeys = Object.keys(candidate);
	if (actualKeys.some((key) => FORBIDDEN_NAMES.has(key))) throw new Error(`Invalid ${label}`);
	if (actualKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(candidate, key))) {
		throw new Error(`Invalid ${label}`);
	}
	return candidate;
}

function parseJson(text: string, label: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid ${label}`, { cause: error });
	}
}

function isUuid(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
	);
}

function parseFeed(text: string): FeedMetadata {
	const candidate = exactObject(
		parseJson(text, "log source metadata"),
		[
			"formatVersion",
			"sourceId",
			"nextSegmentSequence",
			"retentionGeneration",
			"truncationGeneration",
		],
		"log source metadata",
	);
	if (
		candidate.formatVersion !== FORMAT_VERSION ||
		!isUuid(candidate.sourceId) ||
		!Number.isSafeInteger(candidate.nextSegmentSequence) ||
		(candidate.nextSegmentSequence as number) < 1 ||
		!Number.isSafeInteger(candidate.retentionGeneration) ||
		(candidate.retentionGeneration as number) < 0 ||
		!Number.isSafeInteger(candidate.truncationGeneration) ||
		(candidate.truncationGeneration as number) < 0
	) {
		throw new Error("Invalid log source metadata");
	}
	return {
		formatVersion: FORMAT_VERSION,
		sourceId: candidate.sourceId,
		nextSegmentSequence: candidate.nextSegmentSequence as number,
		retentionGeneration: candidate.retentionGeneration as number,
		truncationGeneration: candidate.truncationGeneration as number,
	};
}

function writeJsonAtomicSync(filePath: string, value: unknown): void {
	const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		const descriptor = openSync(temporaryPath, "r");
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
		renameSync(temporaryPath, filePath);
	} catch (error) {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// The temporary file may not have been created.
		}
		throw error;
	}
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
	const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		const handle = await open(temporaryPath, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporaryPath, filePath);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

function utcDate(timestamp: number): string {
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime()))
		throw new Error("The log source clock returned an invalid time");
	return date.toISOString().slice(0, 10);
}

function segmentBase(sequence: number, id: string, date: string, state: Segment["state"]): string {
	return `launchpad-${String(sequence).padStart(16, "0")}-${id}-${date}.${state}`;
}

function segmentFromName(directory: string, fileName: string): Segment | null {
	const match = SEGMENT_PATTERN.exec(fileName);
	if (!match) return null;
	const sequence = Number(match[1]);
	if (!Number.isSafeInteger(sequence)) return null;
	const id = match[2];
	const date = match[3];
	const state = match[4];
	if (!id || !date || (state !== "active" && state !== "sealed")) return null;
	const base = segmentBase(sequence, id, date, state);
	return {
		sequence,
		id,
		date,
		state,
		canonicalPath: path.join(directory, `${base}.jsonl`),
		textPath: path.join(directory, `${base}.log`),
	};
}

function listSegmentsSync(directory: string): Segment[] {
	return readdirSync(directory)
		.map((fileName) => segmentFromName(directory, fileName))
		.filter((segment): segment is Segment => segment !== null)
		.sort((left, right) => left.sequence - right.sequence);
}

async function listSegments(directory: string): Promise<Segment[]> {
	return (await readdir(directory))
		.map((fileName) => segmentFromName(directory, fileName))
		.filter((segment): segment is Segment => segment !== null)
		.sort((left, right) => left.sequence - right.sequence);
}

function sealedSegment(segment: Segment): Segment {
	const base = segmentBase(segment.sequence, segment.id, segment.date, "sealed");
	return {
		...segment,
		state: "sealed",
		canonicalPath: path.join(path.dirname(segment.canonicalPath), `${base}.jsonl`),
		textPath: path.join(path.dirname(segment.textPath), `${base}.log`),
	};
}

function truncateIncompleteTailSync(filePath: string): boolean {
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

function chainHash(previousHash: string, bytes: Buffer): string {
	return createHash("sha256").update(previousHash).update(bytes).digest("hex");
}

function encodeOpaque(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseCursor(value: unknown, expectedSourceId: string, label: string): Cursor {
	const candidate = exactObject(
		value,
		[
			"formatVersion",
			"sourceId",
			"segmentSequence",
			"segmentId",
			"offset",
			"chainHash",
			"seenRetentionGeneration",
			"seenTruncationGeneration",
		],
		label,
	);
	if (
		candidate.formatVersion !== FORMAT_VERSION ||
		candidate.sourceId !== expectedSourceId ||
		!Number.isSafeInteger(candidate.segmentSequence) ||
		(candidate.segmentSequence as number) < 1 ||
		!isUuid(candidate.segmentId) ||
		!Number.isSafeInteger(candidate.offset) ||
		(candidate.offset as number) < 0 ||
		typeof candidate.chainHash !== "string" ||
		!/^[0-9a-f]{64}$/.test(candidate.chainHash) ||
		!Number.isSafeInteger(candidate.seenRetentionGeneration) ||
		(candidate.seenRetentionGeneration as number) < 0 ||
		!Number.isSafeInteger(candidate.seenTruncationGeneration) ||
		(candidate.seenTruncationGeneration as number) < 0
	) {
		throw new Error(`Invalid ${label}`);
	}
	return candidate as Cursor;
}

function decodeBarrier(barrier: string, sourceId: string): Cursor {
	let decoded: unknown;
	try {
		decoded = JSON.parse(Buffer.from(barrier, "base64url").toString("utf8"));
	} catch (error) {
		throw new Error("Invalid log source barrier", { cause: error });
	}
	return parseCursor(decoded, sourceId, "log source barrier");
}

function cursorAtStart(
	segment: Segment,
	sourceId: string,
	seenRetentionGeneration: number,
	seenTruncationGeneration: number,
): Cursor {
	return {
		formatVersion: FORMAT_VERSION,
		sourceId,
		segmentSequence: segment.sequence,
		segmentId: segment.id,
		offset: 0,
		chainHash: EMPTY_CHAIN_HASH,
		seenRetentionGeneration,
		seenTruncationGeneration,
	};
}

function cursorReached(cursor: Cursor, through: Cursor): boolean {
	return (
		cursor.segmentSequence > through.segmentSequence ||
		(cursor.segmentSequence === through.segmentSequence && cursor.offset >= through.offset)
	);
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new Error("Operation aborted");
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason ?? new Error("Operation aborted"));
		// Cancellation bounds the caller's wait, not the underlying operation.
		// Always observe its settlement, even when cancellation predates this call.
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		operation.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

function safeDiagnostic(callback: ((message: string) => void) | undefined, message: string): void {
	try {
		callback?.(message);
	} catch {
		// Diagnostics must never feed back into logging or fail source operations.
	}
}

function sanitizeTextLine(line: string): string {
	return `${line.replaceAll("\r", "\\r").replaceAll("\n", "\\n")}\n`;
}

function assertSafeJsonNames(value: unknown, depth = 0): void {
	if (depth > 16 || value === null || typeof value !== "object") return;
	for (const key of Object.keys(value)) {
		if (FORBIDDEN_NAMES.has(key)) throw new Error("Invalid structured log prototype property");
		assertSafeJsonNames((value as Record<string, unknown>)[key], depth + 1);
	}
}

class SegmentChangedError extends Error {}

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

async function computeChainToOffset(segment: Segment, offset: number): Promise<string> {
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

async function segmentSignature(segment: Segment): Promise<string> {
	const file = await stat(segment.canonicalPath, { bigint: true });
	return `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`;
}

class FileSourceState {
	readonly source: LoggerSource;
	private readonly directory: string;
	private readonly feedPath: string;
	private readonly checkpointDirectory: string;
	private readonly lock: LogDirectoryLock;
	private readonly maxSegmentBytes: number;
	private readonly maxBytes: number;
	private readonly maxAgeMs: number;
	private readonly maxPendingRecords: number;
	private readonly now: () => number;
	private readonly onDiagnostic?: (message: string) => void;
	private readonly runtimeId = randomUUID();
	private readonly feed: FeedMetadata;
	private resourceSnapshot: ResourceAttributes;
	private activeSegment: Segment;
	private activeBytes = 0;
	private activeChainHash = EMPTY_CHAIN_HASH;
	private activeRecordCount = 0;
	private readonly queue: PendingRecord[] = [];
	private draining = false;
	private drainWaiters: Array<() => void> = [];
	private closing = false;
	private closePromise?: Promise<void>;
	private activeOperations = 0;
	private ioTail: Promise<unknown> = Promise.resolve();
	private readonly verifiedPrefixes = new Map<
		string,
		{ signature: string; offset: number; hash: string }
	>();
	private operationWaiters: Array<() => void> = [];
	private readonly activeReaderIds = new Set<string>();
	private statusState: MutableStatus = {
		available: true,
		pendingRecords: 0,
		droppedRecords: 0,
		lossEvents: 0,
	};

	constructor(options: LogFileSourceOptions, lock: LogDirectoryLock) {
		this.directory = path.resolve(options.directory);
		this.feedPath = path.join(this.directory, "feed.json");
		this.checkpointDirectory = path.join(this.directory, "checkpoints");
		this.lock = lock;
		this.maxSegmentBytes = safeInteger(options.maxSegmentBytes, DEFAULT_SEGMENT_BYTES, 1_024);
		this.maxBytes = safeInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1_024);
		this.maxAgeMs = safeInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS, 0);
		this.maxPendingRecords = safeInteger(options.maxPendingRecords, DEFAULT_MAX_PENDING_RECORDS);
		this.now = options.now ?? Date.now;
		this.onDiagnostic = options.onDiagnostic;
		mkdirSync(this.checkpointDirectory, { recursive: true, mode: 0o700 });
		this.feed = this.loadOrCreateFeed();
		this.recoverSegments();
		this.activeSegment = this.createActiveSegment();
		const baseResourceAttributes = Object.freeze({
			"service.name": "launchpad",
			"service.instance.id": this.runtimeId,
		});
		this.resourceSnapshot = baseResourceAttributes;
		const state = this;
		this.source = {
			identity: Object.freeze({
				sourceId: this.feed.sourceId,
				runtimeId: this.runtimeId,
				baseResourceAttributes,
			}),
			get resourceAttributes() {
				return state.resourceSnapshot;
			},
			get status() {
				return state.status();
			},
			configureResourceAttributes(attributes) {
				state.configureResourceAttributes(attributes);
			},
			flush(signal) {
				return state.flush(signal);
			},
			createReader(identity, signal) {
				return state.createReader(identity.checkpointId, signal);
			},
		};
	}

	private loadOrCreateFeed(): FeedMetadata {
		if (existsSync(this.feedPath)) return parseFeed(readFileSync(this.feedPath, "utf8"));
		const feed: FeedMetadata = {
			formatVersion: FORMAT_VERSION,
			sourceId: randomUUID(),
			nextSegmentSequence: 1,
			retentionGeneration: 0,
			truncationGeneration: 0,
		};
		writeJsonAtomicSync(this.feedPath, feed);
		return feed;
	}

	private recoverSegments(): void {
		const segments = listSegmentsSync(this.directory);
		let maximumSequence = 0;
		let recoveredTruncation = false;
		for (const segment of segments) {
			maximumSequence = Math.max(maximumSequence, segment.sequence);
			if (segment.state !== "active") continue;
			recoveredTruncation =
				truncateIncompleteTailSync(segment.canonicalPath) || recoveredTruncation;
			const sealed = sealedSegment(segment);
			renameSync(segment.canonicalPath, sealed.canonicalPath);
			if (existsSync(segment.textPath)) renameSync(segment.textPath, sealed.textPath);
		}
		let metadataChanged = false;
		if (this.feed.nextSegmentSequence <= maximumSequence) {
			this.feed.nextSegmentSequence = maximumSequence + 1;
			metadataChanged = true;
		}
		if (recoveredTruncation) {
			this.feed.truncationGeneration += 1;
			metadataChanged = true;
		}
		if (metadataChanged) writeJsonAtomicSync(this.feedPath, this.feed);
	}

	private createActiveSegment(): Segment {
		const sequence = this.feed.nextSegmentSequence;
		this.feed.nextSegmentSequence += 1;
		writeJsonAtomicSync(this.feedPath, this.feed);
		const id = randomUUID();
		const date = utcDate(this.now());
		const base = segmentBase(sequence, id, date, "active");
		const segment: Segment = {
			sequence,
			id,
			date,
			state: "active",
			canonicalPath: path.join(this.directory, `${base}.jsonl`),
			textPath: path.join(this.directory, `${base}.log`),
		};
		closeSync(openSync(segment.canonicalPath, "ax", 0o600));
		this.activeBytes = 0;
		this.activeChainHash = EMPTY_CHAIN_HASH;
		this.activeRecordCount = 0;
		return segment;
	}

	append(record: NormalizedLogRecord, textLine?: string): boolean {
		if (this.closing || this.statusState.pendingRecords >= this.maxPendingRecords) {
			this.recordLoss(1, this.closing ? "log source is closing" : "pending log buffer is full");
			return false;
		}
		let canonicalLine: string;
		try {
			canonicalLine = `${serializeLogRecord(record)}\n`;
		} catch (error) {
			this.recordLoss(1, `log record serialization failed: ${errorMessage(error)}`);
			return false;
		}
		this.queue.push({
			canonicalLine,
			...(textLine === undefined ? {} : { textLine: sanitizeTextLine(textLine) }),
		});
		this.statusState.pendingRecords += 1;
		this.startDrain();
		return true;
	}

	private startDrain(): void {
		if (this.draining) return;
		this.draining = true;
		void this.track(async () => {
			try {
				while (this.queue.length > 0) {
					const pending = this.queue.shift();
					if (!pending) break;
					try {
						await this.serialize(() => this.writePending(pending));
						this.statusState.pendingRecords -= 1;
						this.statusState.available = true;
						delete this.statusState.lastError;
					} catch (error) {
						const lost = 1 + this.queue.length;
						this.queue.length = 0;
						this.statusState.pendingRecords = 0;
						this.recordLoss(lost, `log file write failed: ${errorMessage(error)}`);
						this.statusState.available = false;
						await this.serialize(() => this.abandonActiveAfterFailure());
					}
				}
			} finally {
				this.draining = false;
				for (const resolve of this.drainWaiters.splice(0)) resolve();
				if (this.queue.length > 0) this.startDrain();
			}
		});
	}

	private async writePending(pending: PendingRecord): Promise<void> {
		const bytes = Buffer.byteLength(pending.canonicalLine, "utf8");
		const date = utcDate(this.now());
		if (
			this.activeRecordCount > 0 &&
			(this.activeBytes + bytes > this.maxSegmentBytes || date !== this.activeSegment.date)
		) {
			await this.rotate();
		}
		await appendFile(this.activeSegment.canonicalPath, pending.canonicalLine, "utf8");
		const lineBytes = Buffer.from(pending.canonicalLine, "utf8");
		this.activeBytes += lineBytes.length;
		this.activeRecordCount += 1;
		this.activeChainHash = chainHash(this.activeChainHash, lineBytes);
		if (pending.textLine !== undefined) {
			await appendFile(this.activeSegment.textPath, pending.textLine, {
				encoding: "utf8",
				mode: 0o600,
			});
		}
	}

	private async rotate(): Promise<void> {
		await this.sealActive();
		this.activeSegment = this.createActiveSegment();
		await this.enforceRetention();
	}

	private async sealActive(): Promise<void> {
		const sealed = sealedSegment(this.activeSegment);
		await rename(this.activeSegment.canonicalPath, sealed.canonicalPath);
		if (existsSync(this.activeSegment.textPath)) {
			await rename(this.activeSegment.textPath, sealed.textPath);
		}
		this.activeSegment = sealed;
	}

	private async abandonActiveAfterFailure(): Promise<void> {
		try {
			if (existsSync(this.activeSegment.canonicalPath)) await this.sealActive();
			this.activeSegment = this.createActiveSegment();
		} catch (error) {
			this.statusState.lastError = `log source recovery failed: ${errorMessage(error)}`;
			safeDiagnostic(this.onDiagnostic, this.statusState.lastError);
		}
	}

	private async enforceRetention(): Promise<void> {
		const segments = await listSegments(this.directory);
		const sized = await Promise.all(
			segments.map(async (segment) => {
				const canonicalSize = (await stat(segment.canonicalPath)).size;
				const textSize = existsSync(segment.textPath) ? (await stat(segment.textPath)).size : 0;
				return { segment, bytes: canonicalSize + textSize };
			}),
		);
		let totalBytes = sized.reduce((sum, item) => sum + item.bytes, 0);
		const cutoff = this.now() - this.maxAgeMs;
		for (const item of sized) {
			if (item.segment.state !== "sealed") continue;
			const segmentTime = Date.parse(`${item.segment.date}T00:00:00.000Z`);
			if (segmentTime >= cutoff && totalBytes <= this.maxBytes) continue;
			// Persist loss intent before unlink: a crash may over-report loss, never hide it.
			this.feed.retentionGeneration += 1;
			await writeJsonAtomic(this.feedPath, this.feed);
			await rm(item.segment.canonicalPath, { force: true });
			await rm(item.segment.textPath, { force: true });
			totalBytes -= item.bytes;
		}
	}

	private recordLoss(count: number, message: string): void {
		this.statusState.droppedRecords += count;
		this.statusState.lossEvents += 1;
		this.statusState.lastError = message;
		safeDiagnostic(this.onDiagnostic, message);
	}

	private status(): LoggerSourceStatus {
		return Object.freeze({ ...this.statusState });
	}

	private configureResourceAttributes(attributes: ResourceAttributes): void {
		this.resourceSnapshot = Object.freeze({
			...this.source.identity.baseResourceAttributes,
			...attributes,
			"service.instance.id": this.runtimeId,
		});
	}

	private async waitForDrain(): Promise<void> {
		if (!this.draining && this.queue.length === 0) return;
		await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
		if (this.draining || this.queue.length > 0) await this.waitForDrain();
	}

	private async syncActive(): Promise<void> {
		if (!existsSync(this.activeSegment.canonicalPath)) return;
		const handle = await open(this.activeSegment.canonicalPath, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
		if (!existsSync(this.activeSegment.textPath)) return;
		const textHandle = await open(this.activeSegment.textPath, "r");
		try {
			await textHandle.sync();
		} finally {
			await textHandle.close();
		}
	}

	async flush(signal: AbortSignal): Promise<LogSourceBarrier> {
		throwIfAborted(signal);
		if (this.closing) throw new Error("Log source is closing");
		const operation = this.track(async () => {
			await this.waitForDrain();
			return this.serialize(async () => {
				await this.syncActive();
				return encodeOpaque(this.currentEndCursor());
			});
		});
		return awaitWithSignal(operation, signal);
	}

	private currentEndCursor(): Cursor {
		return {
			formatVersion: FORMAT_VERSION,
			sourceId: this.feed.sourceId,
			segmentSequence: this.activeSegment.sequence,
			segmentId: this.activeSegment.id,
			offset: this.activeBytes,
			chainHash: this.activeChainHash,
			seenRetentionGeneration: this.feed.retentionGeneration,
			seenTruncationGeneration: this.feed.truncationGeneration,
		};
	}

	private checkpointPath(checkpointId: string): string {
		const digest = createHash("sha256").update(checkpointId).digest("hex");
		return path.join(this.checkpointDirectory, `reader-${digest}.json`);
	}

	private validateCheckpointId(checkpointId: string): void {
		if (!CHECKPOINT_ID_PATTERN.test(checkpointId) || FORBIDDEN_NAMES.has(checkpointId)) {
			throw new Error("Invalid log reader checkpoint identity");
		}
	}

	async createReader(checkpointId: string, signal: AbortSignal): Promise<LoggerSourceReader> {
		throwIfAborted(signal);
		if (this.closing) throw new Error("Log source is closing");
		this.validateCheckpointId(checkpointId);
		if (this.activeReaderIds.has(checkpointId)) throw new Error("Log reader is already open");
		this.activeReaderIds.add(checkpointId);
		const operation = this.track(async () => {
			try {
				const checkpoint = await this.serialize(() => this.loadCheckpoint(checkpointId));
				throwIfAborted(signal);
				return new FileSourceReader(this, checkpointId, checkpoint.cursor, checkpoint.gaps);
			} catch (error) {
				this.activeReaderIds.delete(checkpointId);
				throw error;
			}
		});
		return awaitWithSignal(operation, signal);
	}

	private async oldestCursor(): Promise<Cursor> {
		const segments = await listSegments(this.directory);
		const oldest = segments[0] ?? this.activeSegment;
		return cursorAtStart(oldest, this.feed.sourceId, 0, 0);
	}

	private async loadCheckpoint(
		checkpointId: string,
	): Promise<{ cursor: Cursor; gaps: LogSourceGap[] }> {
		const checkpointPath = this.checkpointPath(checkpointId);
		if (!existsSync(checkpointPath)) {
			const cursor = await this.oldestCursor();
			await writeJsonAtomic(checkpointPath, {
				formatVersion: FORMAT_VERSION,
				sourceId: this.feed.sourceId,
				checkpointId,
				cursor,
			});
			return { cursor, gaps: [] };
		}
		const checkpointHandle = await open(checkpointPath, "r");
		let text: string;
		try {
			text = await checkpointHandle.readFile({ encoding: "utf8" });
		} finally {
			await checkpointHandle.close();
		}
		try {
			const candidate = exactObject(
				parseJson(text, "log reader checkpoint"),
				["formatVersion", "sourceId", "checkpointId", "cursor"],
				"log reader checkpoint",
			);
			if (
				candidate.formatVersion !== FORMAT_VERSION ||
				candidate.sourceId !== this.feed.sourceId ||
				candidate.checkpointId !== checkpointId
			) {
				throw new Error("Invalid log reader checkpoint identity");
			}
			return {
				cursor: parseCursor(candidate.cursor, this.feed.sourceId, "log reader checkpoint cursor"),
				gaps: [],
			};
		} catch {
			return {
				cursor: await this.oldestCursor(),
				gaps: [
					{
						reason: "corruption",
						lostRecords: null,
						detail:
							"The reader checkpoint was corrupt; replay resumed from the oldest retained record",
					},
				],
			};
		}
	}

	async read(
		cursor: Cursor,
		request: LogSourceReadRequest,
	): Promise<{ batch: LogSourceBatch; cursor: Cursor }> {
		if (this.closing) throw new Error("Log source is closing");
		throwIfAborted(request.signal);
		if (
			!Number.isSafeInteger(request.maxEntries) ||
			request.maxEntries < 1 ||
			request.maxEntries > MAX_READ_ENTRIES
		) {
			throw new Error("Invalid log source maxEntries");
		}
		if (
			!Number.isSafeInteger(request.maxBytes) ||
			request.maxBytes < 1 ||
			request.maxBytes > MAX_READ_BYTES
		) {
			throw new Error("Invalid log source maxBytes");
		}
		const through =
			request.through === undefined
				? undefined
				: decodeBarrier(request.through, this.feed.sourceId);
		return awaitWithSignal(
			this.track(() =>
				this.serialize(() => this.readBatch(cursor, request.maxEntries, request.maxBytes, through)),
			),
			request.signal,
		);
	}

	private async readBatch(
		originalCursor: Cursor,
		maxEntries: number,
		maxBytes: number,
		through: Cursor | undefined,
	): Promise<{ batch: LogSourceBatch; cursor: Cursor }> {
		const segments = await listSegments(this.directory);
		if (segments.length === 0) throw new Error("Log source has no active segment");
		let cursor = { ...originalCursor };
		const gaps: LogSourceGap[] = [];
		let index = segments.findIndex((segment) => segment.sequence === cursor.segmentSequence);
		if (index < 0) {
			const oldest = segments[0];
			if (
				!oldest ||
				cursor.segmentSequence >= oldest.sequence ||
				cursor.seenRetentionGeneration >= this.feed.retentionGeneration
			) {
				throw new Error("Log source segment identity is unknown");
			}
			gaps.push({
				reason: "retention",
				lostRecords: null,
				detail: "Retention removed unread backlog; the number of lost records is unknown",
			});
			cursor = cursorAtStart(
				oldest,
				this.feed.sourceId,
				this.feed.retentionGeneration,
				cursor.seenTruncationGeneration,
			);
			index = 0;
		} else if (segments[index]?.id !== cursor.segmentId) {
			throw new Error("Log source segment identity does not match the checkpoint");
		}

		const checkpointSegment = segments[index];
		if (!checkpointSegment) throw new Error("Log source segment identity is unknown");
		const signature = await segmentSignature(checkpointSegment);
		const verified = this.verifiedPrefixes.get(checkpointSegment.id);
		try {
			const actualHash =
				verified?.signature === signature && verified.offset === cursor.offset
					? verified.hash
					: await computeChainToOffset(checkpointSegment, cursor.offset);
			if (actualHash !== cursor.chainHash)
				throw new SegmentChangedError("Log source segment content changed");
		} catch (error) {
			if (!(error instanceof SegmentChangedError)) throw error;
			gaps.push({
				reason: "truncation",
				lostRecords: null,
				detail: "The checkpointed segment was truncated or replaced; replay resumed from its start",
			});
			cursor = cursorAtStart(
				checkpointSegment,
				this.feed.sourceId,
				cursor.seenRetentionGeneration,
				cursor.seenTruncationGeneration,
			);
		}
		if (
			cursor.seenRetentionGeneration < this.feed.retentionGeneration &&
			cursor.offset === 0 &&
			index === 0
		) {
			gaps.push({
				reason: "retention",
				lostRecords: null,
				detail: "Retention removed earlier backlog; the number of lost records is unknown",
			});
			cursor.seenRetentionGeneration = this.feed.retentionGeneration;
		}
		if (cursor.seenTruncationGeneration < this.feed.truncationGeneration) {
			gaps.push({
				reason: "truncation",
				lostRecords: null,
				detail:
					"Crash recovery removed an incomplete record; the number of lost records is unknown",
			});
			cursor.seenTruncationGeneration = this.feed.truncationGeneration;
		}

		const records: NormalizedLogRecord[] = [];
		let returnedBytes = 0;
		const readLine = bufferedLines();
		let progressEvents = gaps.length;
		while (
			index < segments.length &&
			records.length < maxEntries &&
			progressEvents < maxEntries &&
			returnedBytes < maxBytes &&
			(!through || !cursorReached(cursor, through))
		) {
			const segment = segments[index];
			if (!segment) break;
			const end = Math.min(
				through?.segmentSequence === segment.sequence ? through.offset : Number.MAX_SAFE_INTEGER,
				cursor.offset + maxBytes - returnedBytes,
			);
			const line = await readLine(segment.canonicalPath, cursor.offset, end);
			if (line.kind === "eof") {
				if (segment.state === "active" || index + 1 >= segments.length) break;
				index += 1;
				progressEvents += 1;
				const nextSegment = segments[index];
				if (!nextSegment) break;
				cursor = cursorAtStart(
					nextSegment,
					this.feed.sourceId,
					cursor.seenRetentionGeneration,
					cursor.seenTruncationGeneration,
				);
				continue;
			}
			if (line.kind === "partial") {
				// A byte budget or barrier can end inside a complete on-disk line.
				if (cursor.offset + line.bytes >= end || segment.state === "active") break;
				gaps.push({
					reason: "corruption",
					lostRecords: null,
					detail: "A sealed segment ended with an incomplete record; loss is unknown",
				});
				const nextSegment = segments[index + 1];
				if (!nextSegment) break;
				index += 1;
				cursor = cursorAtStart(
					nextSegment,
					this.feed.sourceId,
					cursor.seenRetentionGeneration,
					cursor.seenTruncationGeneration,
				);
				progressEvents += 1;
				continue;
			}
			const lineBytes = line.nextOffset - cursor.offset;
			if (returnedBytes + lineBytes > maxBytes) break;
			returnedBytes += lineBytes;
			if (line.bytes.length === 0) {
				gaps.push({
					reason: "corruption",
					lostRecords: null,
					detail: "An oversized record was skipped; loss is unknown",
				});
				if (segment.state === "active") break;
				const nextSegment = segments[index + 1];
				if (!nextSegment) break;
				index += 1;
				cursor = cursorAtStart(
					nextSegment,
					this.feed.sourceId,
					cursor.seenRetentionGeneration,
					cursor.seenTruncationGeneration,
				);
				progressEvents += 1;
				continue;
			}
			let parsed: NormalizedLogRecord;
			try {
				const untrusted: unknown = JSON.parse(line.line);
				assertSafeJsonNames(untrusted);
				parsed = parseLogRecord(line.line);
			} catch {
				gaps.push({
					reason: "corruption",
					lostRecords: null,
					detail: "A malformed canonical record was skipped; loss is unknown",
				});
				cursor.offset = line.nextOffset;
				cursor.chainHash = chainHash(cursor.chainHash, line.bytes);
				progressEvents += 1;
				continue;
			}
			records.push(parsed);
			cursor.offset = line.nextOffset;
			cursor.chainHash = chainHash(cursor.chainHash, line.bytes);
			progressEvents += 1;
			if (through && cursorReached(cursor, through)) break;
		}
		if (
			cursor.segmentId === checkpointSegment.id &&
			(await segmentSignature(checkpointSegment)) === signature
		) {
			if (this.verifiedPrefixes.size >= 64) this.verifiedPrefixes.clear();
			this.verifiedPrefixes.set(cursor.segmentId, {
				signature,
				offset: cursor.offset,
				hash: cursor.chainHash,
			});
		}
		const receipt = encodeOpaque({ reader: randomUUID(), cursor });
		return {
			cursor,
			batch: {
				records,
				gaps,
				receipt,
				reachedThrough: through === undefined ? false : cursorReached(cursor, through),
			},
		};
	}

	async acknowledge(
		checkpointId: string,
		cursor: Cursor,
		signal: AbortSignal,
		unchanged = false,
	): Promise<void> {
		throwIfAborted(signal);
		if (this.closing) throw new Error("Log source is closing");
		if (unchanged) return;
		const checkpoint = {
			formatVersion: FORMAT_VERSION,
			sourceId: this.feed.sourceId,
			checkpointId,
			cursor,
		};
		await awaitWithSignal(
			this.track(() =>
				this.serialize(() => writeJsonAtomic(this.checkpointPath(checkpointId), checkpoint)),
			),
			signal,
		);
	}

	readerClosed(checkpointId: string): void {
		this.activeReaderIds.delete(checkpointId);
	}

	/** Enqueue before awaiting. Handles close before the next mutation starts. */
	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.ioTail.then(operation);
		this.ioTail = result.catch(() => undefined);
		return result;
	}

	private track<T>(operation: () => Promise<T>): Promise<T> {
		this.activeOperations += 1;
		return operation().finally(() => {
			this.activeOperations -= 1;
			if (this.activeOperations === 0) {
				for (const resolve of this.operationWaiters.splice(0)) resolve();
			}
		});
	}

	private async waitForOperations(): Promise<void> {
		if (this.activeOperations === 0) return;
		await new Promise<void>((resolve) => this.operationWaiters.push(resolve));
	}

	close(signal: AbortSignal): Promise<void> {
		this.closing = true;
		this.closePromise ??= (async () => {
			await this.waitForDrain();
			await this.waitForOperations();
			try {
				if (existsSync(this.activeSegment.canonicalPath)) {
					await this.syncActive();
					await this.sealActive();
					await this.enforceRetention();
				}
			} catch (error) {
				this.statusState.available = false;
				this.statusState.lastError = `Log source close failed: ${errorMessage(error)}`;
				safeDiagnostic(this.onDiagnostic, this.statusState.lastError);
				throw error;
			} finally {
				this.lock.release();
			}
		})();
		return awaitWithSignal(this.closePromise, signal);
	}
}

class FileSourceReader implements LoggerSourceReader {
	private cursor: Cursor;
	private initialGaps: LogSourceGap[];
	private outstanding?: { receipt: LogReadReceipt; cursor: Cursor };
	private closed = false;
	private reading = false;
	private acknowledging = false;

	constructor(
		private readonly source: FileSourceState,
		private readonly checkpointId: string,
		cursor: Cursor,
		initialGaps: LogSourceGap[],
	) {
		this.cursor = cursor;
		this.initialGaps = initialGaps;
	}

	async read(request: LogSourceReadRequest): Promise<LogSourceBatch> {
		if (this.closed) throw new Error("Log reader is closed");
		if (this.outstanding || this.reading)
			throw new Error("Log reader has an outstanding receipt or read in progress");
		this.reading = true;
		try {
			const result = await this.source.read(this.cursor, request);
			this.outstanding = { receipt: result.batch.receipt, cursor: result.cursor };
			if (this.initialGaps.length === 0) return result.batch;
			return { ...result.batch, gaps: [...this.initialGaps, ...result.batch.gaps] };
		} finally {
			this.reading = false;
		}
	}

	async ack(receipt: LogReadReceipt, signal: AbortSignal): Promise<void> {
		if (this.closed) throw new Error("Log reader is closed");
		if (this.acknowledging || !this.outstanding || receipt !== this.outstanding.receipt) {
			throw new Error("Invalid or stale log read receipt");
		}
		this.acknowledging = true;
		try {
			const unchanged =
				this.initialGaps.length === 0 &&
				encodeOpaque(this.cursor) === encodeOpaque(this.outstanding.cursor);
			await this.source.acknowledge(this.checkpointId, this.outstanding.cursor, signal, unchanged);
			this.cursor = this.outstanding.cursor;
			this.outstanding = undefined;
			this.initialGaps = [];
		} finally {
			this.acknowledging = false;
		}
	}

	async close(signal: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		if (this.closed) return;
		this.closed = true;
		this.source.readerClosed(this.checkpointId);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createLogFileSource(options: LogFileSourceOptions): LogFileSourceOwner {
	const directory = path.resolve(options.directory);
	const lock = acquireLogDirectoryLock(directory);
	try {
		const state = new FileSourceState({ ...options, directory }, lock);
		return {
			source: state.source,
			append: (record, textLine) => state.append(record, textLine),
			close: (signal) => state.close(signal),
		};
	} catch (error) {
		lock.release();
		throw error;
	}
}
