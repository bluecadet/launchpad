import { createHash } from "node:crypto";
import path from "node:path";

/** Control-file and segment identity codecs. User records use the shared logging codec. */
export const FORMAT_VERSION = 1;
export const EMPTY_CHAIN_HASH = createHash("sha256")
	.update("launchpad-log-segment-v1")
	.digest("hex");
const SEGMENT_PATTERN =
	/^launchpad-(\d{16})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(\d{4}-\d{2}-\d{2})\.(active|sealed)\.jsonl$/;
export const CHECKPOINT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const FORBIDDEN_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export type FeedMetadata = {
	formatVersion: 1;
	sourceId: string;
	nextSegmentSequence: number;
	retentionGeneration: number;
	truncationGeneration: number;
};

export type Segment = {
	sequence: number;
	id: string;
	date: string;
	state: "active" | "sealed";
	canonicalPath: string;
	textPath: string;
};

export type Cursor = {
	formatVersion: 1;
	sourceId: string;
	segmentSequence: number;
	segmentId: string;
	offset: number;
	chainHash: string;
	seenRetentionGeneration: number;
	seenTruncationGeneration: number;
};

export function safeInteger(value: number | undefined, fallback: number, minimum = 1): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`Expected a safe integer greater than or equal to ${minimum}`);
	}
	return value;
}

export function exactObject(
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

export function parseJson(text: string, label: string): unknown {
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

export function parseFeed(text: string): FeedMetadata {
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

export function utcDate(timestamp: number): string {
	const date = new Date(timestamp);
	if (!Number.isFinite(date.getTime()))
		throw new Error("The log source clock returned an invalid time");
	return date.toISOString().slice(0, 10);
}

export function segmentBase(
	sequence: number,
	id: string,
	date: string,
	state: Segment["state"],
): string {
	return `launchpad-${String(sequence).padStart(16, "0")}-${id}-${date}.${state}`;
}

export function segmentFromName(directory: string, fileName: string): Segment | null {
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

export function sealedSegment(segment: Segment): Segment {
	const base = segmentBase(segment.sequence, segment.id, segment.date, "sealed");
	return {
		...segment,
		state: "sealed",
		canonicalPath: path.join(path.dirname(segment.canonicalPath), `${base}.jsonl`),
		textPath: path.join(path.dirname(segment.textPath), `${base}.log`),
	};
}

export function chainHash(previousHash: string, bytes: Buffer): string {
	return createHash("sha256").update(previousHash).update(bytes).digest("hex");
}

export function encodeOpaque(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function parseCursor(value: unknown, expectedSourceId: string, label: string): Cursor {
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

export function decodeBarrier(barrier: string, sourceId: string): Cursor {
	let decoded: unknown;
	try {
		decoded = JSON.parse(Buffer.from(barrier, "base64url").toString("utf8"));
	} catch (error) {
		throw new Error("Invalid log source barrier", { cause: error });
	}
	return parseCursor(decoded, sourceId, "log source barrier");
}

export function cursorAtStart(
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

export function cursorReached(cursor: Cursor, through: Cursor): boolean {
	return (
		cursor.segmentSequence > through.segmentSequence ||
		(cursor.segmentSequence === through.segmentSequence && cursor.offset >= through.offset)
	);
}
