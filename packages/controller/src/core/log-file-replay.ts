import { randomUUID } from "node:crypto";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import {
	type LoggerSourceReader,
	type LogReadReceipt,
	type LogSourceBatch,
	type LogSourceGap,
	type LogSourceReadRequest,
	type NormalizedLogRecord,
	parseLogRecord,
} from "@bluecadet/launchpad-utils/logging";
import { ResultAsync } from "neverthrow";
import {
	type Cursor,
	chainHash,
	cursorAtStart,
	cursorReached,
	encodeOpaque,
	type FeedMetadata,
} from "./log-file-codec.js";
import { awaitWithSignal, throwIfAborted } from "./log-file-operations.js";
import {
	bufferedLines,
	computeChainToOffset,
	listSegments,
	SegmentChangedError,
	segmentSignature,
} from "./log-file-storage.js";

export interface ReplayContext {
	readonly directory: string;
	readonly feed: FeedMetadata;
	readonly verifiedPrefixes: Map<string, { signature: string; offset: number; hash: string }>;
}

export interface ReaderOwner {
	read(
		cursor: Cursor,
		request: LogSourceReadRequest,
	): Promise<{ batch: LogSourceBatch; cursor: Cursor }>;
	acknowledge(
		checkpointId: string,
		cursor: Cursor,
		signal: AbortSignal,
		unchanged?: boolean,
	): Promise<void>;
	readerClosed(checkpointId: string): Promise<void>;
}

export async function readLogBatch(
	context: ReplayContext,
	originalCursor: Cursor,
	maxEntries: number,
	maxBytes: number,
	through: Cursor | undefined,
): Promise<{ batch: LogSourceBatch; cursor: Cursor }> {
	const segments = await listSegments(context.directory);
	if (segments.length === 0) throw new Error("Log source has no active segment");
	let cursor = { ...originalCursor };
	const gaps: LogSourceGap[] = [];
	let index = segments.findIndex((segment) => segment.sequence === cursor.segmentSequence);
	if (index < 0) {
		const oldest = segments[0];
		if (
			!oldest ||
			cursor.segmentSequence >= oldest.sequence ||
			cursor.seenRetentionGeneration >= context.feed.retentionGeneration
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
			context.feed.sourceId,
			context.feed.retentionGeneration,
			cursor.seenTruncationGeneration,
		);
		index = 0;
	} else if (segments[index]?.id !== cursor.segmentId) {
		throw new Error("Log source segment identity does not match the checkpoint");
	}

	const checkpointSegment = segments[index];
	if (!checkpointSegment) throw new Error("Log source segment identity is unknown");
	const signature = await segmentSignature(checkpointSegment);
	const verified = context.verifiedPrefixes.get(checkpointSegment.id);
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
			context.feed.sourceId,
			cursor.seenRetentionGeneration,
			cursor.seenTruncationGeneration,
		);
	}
	if (
		cursor.seenRetentionGeneration < context.feed.retentionGeneration &&
		cursor.offset === 0 &&
		index === 0
	) {
		gaps.push({
			reason: "retention",
			lostRecords: null,
			detail: "Retention removed earlier backlog; the number of lost records is unknown",
		});
		cursor.seenRetentionGeneration = context.feed.retentionGeneration;
	}
	if (cursor.seenTruncationGeneration < context.feed.truncationGeneration) {
		gaps.push({
			reason: "truncation",
			lostRecords: null,
			detail: "Crash recovery removed an incomplete record; the number of lost records is unknown",
		});
		cursor.seenTruncationGeneration = context.feed.truncationGeneration;
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
				context.feed.sourceId,
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
				context.feed.sourceId,
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
				context.feed.sourceId,
				cursor.seenRetentionGeneration,
				cursor.seenTruncationGeneration,
			);
			progressEvents += 1;
			continue;
		}
		const parsed = parseLogRecord(line.line);
		if (parsed.isErr()) {
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
		records.push(parsed.value);
		cursor.offset = line.nextOffset;
		cursor.chainHash = chainHash(cursor.chainHash, line.bytes);
		progressEvents += 1;
		if (through && cursorReached(cursor, through)) break;
	}
	if (
		cursor.segmentId === checkpointSegment.id &&
		(await segmentSignature(checkpointSegment)) === signature
	) {
		if (context.verifiedPrefixes.size >= 64) context.verifiedPrefixes.clear();
		context.verifiedPrefixes.set(cursor.segmentId, {
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

export class FileSourceReader implements LoggerSourceReader {
	private cursor: Cursor;
	private initialGaps: LogSourceGap[];
	private outstanding?: { receipt: LogReadReceipt; cursor: Cursor };
	private closed = false;
	private closePromise?: Promise<void>;
	private reading = false;
	private acknowledging = false;

	constructor(
		private readonly source: ReaderOwner,
		private readonly checkpointId: string,
		cursor: Cursor,
		initialGaps: LogSourceGap[],
	) {
		this.cursor = cursor;
		this.initialGaps = initialGaps;
	}

	read(request: LogSourceReadRequest): ResultAsync<LogSourceBatch, Error> {
		return ResultAsync.fromPromise(this.readInternal(request), ensureError);
	}

	private async readInternal(request: LogSourceReadRequest): Promise<LogSourceBatch> {
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

	ack(receipt: LogReadReceipt, signal: AbortSignal): ResultAsync<void, Error> {
		return ResultAsync.fromPromise(this.ackInternal(receipt, signal), ensureError);
	}

	private async ackInternal(receipt: LogReadReceipt, signal: AbortSignal): Promise<void> {
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

	close(signal: AbortSignal): ResultAsync<void, Error> {
		return ResultAsync.fromPromise(this.closeInternal(signal), ensureError);
	}

	private async closeInternal(signal: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		this.closed = true;
		this.closePromise ??= this.source.readerClosed(this.checkpointId);
		await awaitWithSignal(this.closePromise, signal);
	}
}
