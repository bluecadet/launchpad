import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync } from "node:fs";
import { appendFile, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import {
	type LoggerSource,
	type LoggerSourceReader,
	type LoggerSourceStatus,
	type LogSourceBarrier,
	type LogSourceBatch,
	type LogSourceGap,
	type LogSourceReadRequest,
	type NormalizedLogRecord,
	type ResourceAttributes,
	serializeLogRecord,
} from "@bluecadet/launchpad-utils/logging";
import { Result, ResultAsync } from "neverthrow";
import {
	CHECKPOINT_ID_PATTERN,
	type Cursor,
	chainHash,
	cursorAtStart,
	decodeBarrier,
	EMPTY_CHAIN_HASH,
	encodeOpaque,
	exactObject,
	type FeedMetadata,
	FORBIDDEN_NAMES,
	FORMAT_VERSION,
	parseCursor,
	parseFeed,
	parseJson,
	type Segment,
	safeInteger,
	sealedSegment,
	segmentBase,
	utcDate,
} from "./log-file-codec.js";
import { acquireLogDirectoryLock, type LogDirectoryLock } from "./log-file-lock.js";
import {
	awaitWithSignal,
	errorMessage,
	LogFileOperations,
	safeDiagnostic,
	throwIfAborted,
} from "./log-file-operations.js";
import { FileSourceReader, readLogBatch } from "./log-file-replay.js";
import {
	listLogFiles,
	listSegments,
	listSegmentsSync,
	settledValues,
	syncDirectory,
	syncDirectorySync,
	syncFile,
	syncFileSync,
	truncateIncompleteTailSync,
	writeJsonAtomic,
	writeJsonAtomicSync,
} from "./log-file-storage.js";

const DEFAULT_SEGMENT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 28 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_PENDING_RECORDS = 2_048;
const MAX_READ_ENTRIES = 10_000;
const MAX_READ_BYTES = 64 * 1024 * 1024;

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
	close(signal: AbortSignal): ResultAsync<void, Error>;
}

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

function sanitizeTextLine(line: string): string {
	return `${line.replaceAll("\r", "\\r").replaceAll("\n", "\\n")}\n`;
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
	private closing = false;
	private closePromise?: Promise<void>;
	private readonly operations = new LogFileOperations();
	private maintenanceTimer?: ReturnType<typeof setTimeout>;
	private readonly verifiedPrefixes = new Map<
		string,
		{ signature: string; offset: number; hash: string }
	>();
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
				return ResultAsync.fromPromise(state.flush(signal), ensureError);
			},
			createReader(identity, signal) {
				return ResultAsync.fromPromise(
					state.createReader(identity.checkpointId, signal),
					ensureError,
				);
			},
		};
		// Queue startup retention before enrollment or any admitted writes.
		void this.operations
			.enqueue(() => this.maintain())
			.catch((error: unknown) => this.maintenanceFailed(error));
		this.scheduleMaintenance();
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
			syncFileSync(segment.canonicalPath);
			renameSync(segment.canonicalPath, sealed.canonicalPath);
			try {
				if (existsSync(segment.textPath)) renameSync(segment.textPath, sealed.textPath);
			} catch (error) {
				safeDiagnostic(
					this.onDiagnostic,
					`Human-readable log recovery failed: ${errorMessage(error)}`,
				);
			}
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
		syncDirectorySync(this.directory);
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
		syncDirectorySync(this.directory);
		this.activeBytes = 0;
		this.activeChainHash = EMPTY_CHAIN_HASH;
		return segment;
	}

	append(record: NormalizedLogRecord, textLine?: string): boolean {
		if (this.closing || this.statusState.pendingRecords >= this.maxPendingRecords) {
			this.recordLoss(1, this.closing ? "log source is closing" : "pending log buffer is full");
			return false;
		}
		const serialized = serializeLogRecord(record);
		if (serialized.isErr()) {
			this.recordLoss(1, `log record serialization failed: ${serialized.error.message}`);
			return false;
		}
		const pending: PendingRecord = {
			canonicalLine: `${serialized.value}\n`,
			...(textLine === undefined ? {} : { textLine: sanitizeTextLine(textLine) }),
		};
		this.statusState.pendingRecords += 1;
		// Reserve the physical write immediately; barriers cannot be starved by
		// later logger calls. A failed write never discards unrelated admissions.
		void this.operations.enqueue(async () => {
			try {
				await this.writePending(pending);
				this.statusState.available = true;
				delete this.statusState.lastError;
			} catch (error) {
				this.recordLoss(1, `log file write failed: ${errorMessage(error)}`);
				this.statusState.available = false;
				await this.abandonActiveAfterFailure();
			} finally {
				this.statusState.pendingRecords -= 1;
			}
		});
		return true;
	}

	private async writePending(pending: PendingRecord): Promise<void> {
		const bytes = Buffer.byteLength(pending.canonicalLine, "utf8");
		const date = utcDate(this.now());
		if (
			this.activeBytes > 0 &&
			(this.activeBytes + bytes > this.maxSegmentBytes || date !== this.activeSegment.date)
		) {
			await this.rotate();
		}
		await appendFile(this.activeSegment.canonicalPath, pending.canonicalLine, "utf8");
		const lineBytes = Buffer.from(pending.canonicalLine, "utf8");
		this.activeBytes += lineBytes.length;
		this.activeChainHash = chainHash(this.activeChainHash, lineBytes);
		const textLine = pending.textLine;
		if (textLine !== undefined) {
			await this.optionalText("append", () =>
				appendFile(this.activeSegment.textPath, textLine, {
					encoding: "utf8",
					mode: 0o600,
				}),
			);
		}
	}

	private async rotate(): Promise<void> {
		await this.sealActive();
		this.activeSegment = this.createActiveSegment();
		await this.enforceRetention();
	}

	private async sealActive(): Promise<void> {
		const previous = this.activeSegment;
		const sealed = sealedSegment(previous);
		await this.syncActive();
		await rename(previous.canonicalPath, sealed.canonicalPath);
		this.activeSegment = sealed;
		await syncDirectory(this.directory);
		await this.optionalText("seal", async () => {
			if (existsSync(previous.textPath)) await rename(previous.textPath, sealed.textPath);
		});
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

	private async optionalText(operation: string, action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (error) {
			safeDiagnostic(
				this.onDiagnostic,
				`Human-readable log ${operation} failed: ${errorMessage(error)}`,
			);
		}
	}

	private scheduleMaintenance(): void {
		if (this.closing) return;
		this.maintenanceTimer = setTimeout(
			() => {
				this.maintenanceTimer = undefined;
				void this.operations
					.enqueue(() => this.maintain())
					.catch((error: unknown) => this.maintenanceFailed(error))
					.finally(() => this.scheduleMaintenance());
			},
			Math.min(60_000, Math.max(1_000, this.maxAgeMs)),
		);
		this.maintenanceTimer.unref();
	}

	private maintenanceFailed(error: unknown): void {
		safeDiagnostic(this.onDiagnostic, `Log retention failed: ${errorMessage(error)}`);
	}

	private async maintain(): Promise<void> {
		const cutoff = this.now() - this.maxAgeMs;
		if (this.activeBytes > 0 && Date.parse(`${this.activeSegment.date}T00:00:00.000Z`) < cutoff) {
			await this.sealActive();
			this.activeSegment = this.createActiveSegment();
		}
		await this.enforceRetention();
	}

	private async enforceRetention(): Promise<void> {
		const { segments, textSegments } = await listLogFiles(this.directory);
		// Size independent files concurrently, but never advance the owner queue
		// until all sibling I/O has settled (even when one stat fails).
		const sizes = await settledValues([
			...segments.map(async (segment) => ({
				segment,
				text: false,
				bytes: (await stat(segment.canonicalPath)).size,
			})),
			...textSegments.map(async (segment) => {
				let bytes = 0;
				await this.optionalText("stat", async () => {
					bytes = (await stat(segment.textPath)).size;
				});
				return { segment, text: true, bytes };
			}),
		]);
		const canonical = sizes.filter((item) => !item.text);
		const text = sizes.filter((item) => item.text);
		let totalBytes = sizes.reduce((sum, item) => sum + item.bytes, 0);
		const removeText = async (id: string): Promise<void> => {
			for (const item of text.filter((item) => item.segment.id === id)) {
				await this.optionalText("retention", async () => {
					await rm(item.segment.textPath, { force: true });
					totalBytes -= item.bytes;
				});
			}
		};
		const canonicalIds = new Set(segments.map((segment) => segment.id));
		for (const id of new Set(textSegments.map((segment) => segment.id))) {
			if (!canonicalIds.has(id)) await removeText(id);
		}
		const cutoff = this.now() - this.maxAgeMs;
		for (const item of canonical) {
			if (item.segment.state !== "sealed") continue;
			const segmentTime = Date.parse(`${item.segment.date}T00:00:00.000Z`);
			if (segmentTime >= cutoff && totalBytes <= this.maxBytes) continue;
			this.feed.retentionGeneration += 1;
			await writeJsonAtomic(this.feedPath, this.feed);
			await rm(item.segment.canonicalPath, { force: true });
			await syncDirectory(this.directory);
			this.verifiedPrefixes.delete(item.segment.id);
			totalBytes -= item.bytes;
			// Both active and sealed text names belong to the same identity. Failed
			// renames/deletes remain discoverable and count toward retention.
			await removeText(item.segment.id);
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

	private async syncActive(): Promise<void> {
		await syncFile(this.activeSegment.canonicalPath);
		await this.optionalText("sync", async () => {
			if (existsSync(this.activeSegment.textPath)) await syncFile(this.activeSegment.textPath);
		});
	}

	async flush(signal: AbortSignal): Promise<LogSourceBarrier> {
		throwIfAborted(signal);
		if (this.closing) throw new Error("Log source is closing");
		const operation = this.operations.enqueue(async () => {
			await this.syncActive();
			await syncDirectory(this.directory);
			return encodeOpaque(this.currentEndCursor());
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
		const operation = this.operations.enqueue(async () => {
			try {
				await this.maintain();
				const checkpoint = await this.loadCheckpoint(checkpointId);
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
			this.operations.enqueue(() =>
				readLogBatch(
					{ directory: this.directory, feed: this.feed, verifiedPrefixes: this.verifiedPrefixes },
					cursor,
					request.maxEntries,
					request.maxBytes,
					through,
				),
			),
			request.signal,
		);
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
			this.operations.enqueue(() => writeJsonAtomic(this.checkpointPath(checkpointId), checkpoint)),
			signal,
		);
	}

	readerClosed(checkpointId: string): Promise<void> {
		// Enrollment cannot reuse an identity until earlier physical I/O settles.
		return this.operations.enqueue(async () => {
			this.activeReaderIds.delete(checkpointId);
		});
	}

	close(signal: AbortSignal): ResultAsync<void, Error> {
		this.closing = true;
		clearTimeout(this.maintenanceTimer);
		this.maintenanceTimer = undefined;
		this.closePromise ??= this.operations.enqueue(async () => {
			try {
				await this.sealActive();
				await this.enforceRetention();
			} catch (error) {
				this.statusState.available = false;
				this.statusState.lastError = `Log source close failed: ${errorMessage(error)}`;
				safeDiagnostic(this.onDiagnostic, this.statusState.lastError);
				throw error;
			} finally {
				this.lock.release();
			}
		});
		return ResultAsync.fromPromise(awaitWithSignal(this.closePromise, signal), ensureError);
	}
}

/** Acquire a canonical log owner without throwing on validation or filesystem failure. */
export function createLogFileSource(
	options: LogFileSourceOptions,
): Result<LogFileSourceOwner, Error> {
	return Result.fromThrowable(() => {
		const directory = path.resolve(options.directory);
		const lock = acquireLogDirectoryLock(directory);
		try {
			const state = new FileSourceState({ ...options, directory }, lock);
			return {
				source: state.source,
				append: (record: NormalizedLogRecord, textLine?: string) => state.append(record, textLine),
				close: (signal: AbortSignal) => state.close(signal),
			};
		} catch (error) {
			lock.release();
			throw error;
		}
	}, ensureError)();
}
