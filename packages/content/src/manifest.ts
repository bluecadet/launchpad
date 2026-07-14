import fs from "node:fs";
import path from "node:path";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { ensureDir, pad, remove } from "./utils/file-utils.js";

export const MANIFEST_FILENAME = "manifest.json";
export const MANIFEST_SCHEMA_VERSION = 1;

export class ManifestError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "ManifestError";
	}
}

const relativePosixPathSchema = z
	.string()
	.refine((value) => !value.startsWith("/") && !value.includes("\\"), {
		message: "must be a relative, forward-slash path",
	});

const manifestSourceSchema = z.object({
	sourceId: z.string().min(1),
	path: relativePosixPathSchema,
});

/**
 * Schema for the `manifest.json` pointer file written into `downloadPath` under
 * versioned output mode. See the version pointer contract for field semantics:
 * `versionId` is the sole change-detection key; `generatedAt` is informational only.
 */
export const manifestSchema = z.object({
	schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
	versionId: z.string().min(1),
	versionPath: relativePosixPathSchema,
	generatedAt: z.string(),
	sources: z.array(manifestSourceSchema),
});

export type Manifest = z.output<typeof manifestSchema>;
export type ManifestSource = z.output<typeof manifestSourceSchema>;

export type ManifestReadResult =
	| { status: "ok"; manifest: Manifest }
	| { status: "missing" }
	| { status: "invalid"; error: ManifestError };

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const DEFAULT_RENAME_RETRY_ATTEMPTS = 5;
const DEFAULT_RENAME_RETRY_DELAY_MS = 50;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function renameWithRetry(
	src: string,
	dest: string,
	attemptsLeft: number,
	delayMs: number,
): ResultAsync<void, ManifestError> {
	return ResultAsync.fromPromise(
		fs.promises.rename(src, dest),
		(error) => error as NodeJS.ErrnoException,
	).orElse((error) => {
		const isRetryable = RETRYABLE_RENAME_CODES.has(error.code ?? "");
		if (!isRetryable || attemptsLeft <= 1) {
			return errAsync(new ManifestError(`Failed to rename ${src} to ${dest}`, { cause: error }));
		}
		return ResultAsync.fromSafePromise(delay(delayMs)).andThen(() =>
			renameWithRetry(src, dest, attemptsLeft - 1, delayMs),
		);
	});
}

/**
 * Atomically writes `manifest.json` into `downloadPath` via write-temp-then-rename, so
 * readers always see either the fully-old or fully-new manifest, never a torn file. The
 * rename step is retried briefly on Windows sharing violations (`EPERM`/`EACCES`/`EBUSY`)
 * since Node's bare `fs.rename` retries nothing on its own.
 */
export function writeManifest(
	downloadPath: string,
	manifest: Manifest,
	options: { retryAttempts?: number; retryDelayMs?: number } = {},
): ResultAsync<void, ManifestError> {
	const retryAttempts = options.retryAttempts ?? DEFAULT_RENAME_RETRY_ATTEMPTS;
	const retryDelayMs = options.retryDelayMs ?? DEFAULT_RENAME_RETRY_DELAY_MS;

	const manifestPath = path.join(downloadPath, MANIFEST_FILENAME);
	const tempPath = path.join(
		downloadPath,
		`.${MANIFEST_FILENAME}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const json = JSON.stringify(manifest, null, 2);

	const writeAndPromote = ResultAsync.fromPromise(
		fs.promises.writeFile(tempPath, json),
		(error) => new ManifestError(`Failed to write temp manifest at ${tempPath}`, { cause: error }),
	).andThen(() => renameWithRetry(tempPath, manifestPath, retryAttempts, retryDelayMs));

	return ensureDir(downloadPath)
		.mapErr(
			(error) => new ManifestError(`Failed to create directory ${downloadPath}`, { cause: error }),
		)
		.andThen(() =>
			writeAndPromote.orElse((error) =>
				remove(tempPath)
					.orElse(() => okAsync(undefined))
					.andThen(() => errAsync(error)),
			),
		);
}

function parseManifestJson(
	raw: string,
): { success: true; data: Manifest } | { success: false; error: unknown } {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (error) {
		return { success: false, error };
	}

	const result = manifestSchema.safeParse(json);
	if (!result.success) {
		return { success: false, error: result.error };
	}
	return { success: true, data: result.data };
}

/**
 * Reads and validates `manifest.json` from `downloadPath`. Never throws or rejects: a
 * missing file and an unparseable/invalid file are distinct result statuses so callers
 * can decide how to degrade.
 */
export async function readManifest(downloadPath: string): Promise<ManifestReadResult> {
	const manifestPath = path.join(downloadPath, MANIFEST_FILENAME);

	let raw: string;
	try {
		raw = await fs.promises.readFile(manifestPath, "utf8");
	} catch (error) {
		const errnoException = error as NodeJS.ErrnoException;
		if (errnoException.code === "ENOENT") {
			return { status: "missing" };
		}
		return {
			status: "invalid",
			error: new ManifestError(`Failed to read manifest at ${manifestPath}`, { cause: error }),
		};
	}

	const parsed = parseManifestJson(raw);
	if (!parsed.success) {
		return {
			status: "invalid",
			error: new ManifestError(`Failed to parse manifest at ${manifestPath}`, {
				cause: parsed.error,
			}),
		};
	}

	return { status: "ok", manifest: parsed.data };
}

/**
 * Mints a version id: a UTC compact timestamp (e.g. `20260714T153045Z`) that doubles as
 * the version directory name under `versions/`. Lexical sort equals chronological order.
 */
export function mintVersionId(now: Date = new Date()): string {
	const year = now.getUTCFullYear();
	const month = pad(now.getUTCMonth() + 1, 2);
	const day = pad(now.getUTCDate(), 2);
	const hours = pad(now.getUTCHours(), 2);
	const minutes = pad(now.getUTCMinutes(), 2);
	const seconds = pad(now.getUTCSeconds(), 2);
	return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}
