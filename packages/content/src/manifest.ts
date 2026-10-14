import fs from "node:fs";
import path from "node:path";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { ensureDir, move, pad, remove, scratchName } from "./utils/file-utils.js";
import { FilesystemIdentity } from "./utils/filesystem-identity.js";
import { isSafeSourceId } from "./utils/paths-helper.js";

export const MANIFEST_FILENAME = "manifest.json";
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * Filename prefix for the write-temp-then-rename scratch file `writeManifest` uses. A crash
 * between the temp write and the rename leaves one of these behind; the retention sweep reaps
 * stale ones by matching this prefix.
 */
export const MANIFEST_TEMP_PREFIX = `.${MANIFEST_FILENAME}.tmp`;

export class ManifestError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "ManifestError";
	}
}

function isBoundedRelativePath(value: string): boolean {
	return value.split("/").every(isSafeSourceId);
}

const relativePosixPathSchema = z.string().refine(isBoundedRelativePath, {
	message: "must contain only relative, forward-slash directory names (no dot segments)",
});

const manifestSourceSchema = z.object({
	sourceId: z.string().refine(isSafeSourceId),
	path: relativePosixPathSchema,
});

/**
 * Schema for the `manifest.json` pointer file written into `downloadPath` under
 * versioned output mode. See the version pointer contract for field semantics:
 * `versionId` is the sole change-detection key; `generatedAt` is informational only.
 */
const manifestSchema = z.object({
	schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
	versionId: z.string().min(1),
	versionPath: relativePosixPathSchema.refine(
		(value) => {
			const segments = value.split("/");
			return segments.length === 2 && segments[0] === "versions";
		},
		{ message: "must name a directory directly under versions/" },
	),
	generatedAt: z.string(),
	sources: z.array(manifestSourceSchema).refine(
		(sources) => {
			const sourceIds = new Set(sources.map((source) => source.sourceId));
			if (sourceIds.size !== sources.length) return false;
			return sources.every((source, index) =>
				sources
					.slice(index + 1)
					.every(
						(other) =>
							source.path !== other.path &&
							!source.path.startsWith(`${other.path}/`) &&
							!other.path.startsWith(`${source.path}/`),
					),
			);
		},
		{ message: "source entries must be unique and their paths must not overlap" },
	),
});

export type Manifest = z.output<typeof manifestSchema>;

export type ManifestReadResult =
	| { status: "ok"; manifest: Manifest }
	| { status: "missing" }
	| { status: "invalid"; error: ManifestError };

async function walkManifestSourcePath(
	downloadRoot: string,
	manifest: Manifest,
	source: Manifest["sources"][number],
): Promise<string> {
	let resolved = path.resolve(downloadRoot);
	for (const segment of [...manifest.versionPath.split("/"), ...source.path.split("/")]) {
		resolved = path.join(resolved, segment);
		try {
			const entry = await fs.promises.lstat(resolved);
			if (entry.isSymbolicLink()) {
				throw new ManifestError(`Manifest source path contains a symlink: ${resolved}`);
			}
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
			throw error;
		}
	}
	return resolved;
}

/** Validate manifest source separation on the actual filesystem, including case aliases. */
export async function resolveManifestSourceRoots(
	downloadRoot: string,
	manifest: Manifest,
): Promise<ReadonlyMap<string, string>> {
	const validated = manifestSchema.safeParse(manifest);
	if (!validated.success) throw new ManifestError("Cannot resolve unsafe manifest source roots");
	const identity = new FilesystemIdentity();
	const settled = await Promise.allSettled(
		manifest.sources.map(async (source) => {
			const root = await walkManifestSourcePath(downloadRoot, manifest, source);
			return { sourceId: source.sourceId, root, identity: await identity.resolve(root) };
		}),
	);
	const roots = settled.map((result) => {
		if (result.status === "rejected") throw result.reason;
		return result.value;
	});
	for (const [index, source] of roots.entries()) {
		for (const other of roots.slice(index + 1)) {
			if (
				containsPath(source.identity, other.identity) ||
				containsPath(other.identity, source.identity)
			) {
				throw new ManifestError(
					`Manifest sources overlap on this filesystem: ${source.sourceId} and ${other.sourceId}`,
				);
			}
		}
	}
	return new Map(roots.map(({ sourceId, root }) => [sourceId, root]));
}

function containsPath(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return (
		relative === "" ||
		(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
}

const DEFAULT_RENAME_MAX_RETRIES = 4;
const DEFAULT_RENAME_RETRY_DELAY_MS = 50;

/**
 * Atomically writes `manifest.json` into `downloadPath` via write-temp-then-rename, so
 * readers always see either the fully-old or fully-new manifest, never a torn file. The
 * rename step is retried briefly (via `FileUtils.move()`) on Windows sharing violations
 * (`EPERM`/`EACCES`/`EBUSY`) since Node's bare `fs.rename` retries nothing on its own.
 *
 * `maxRetries` counts retries after the first attempt, matching `fs.rm`/`FileUtils.move`.
 */
export function writeManifest(
	downloadPath: string,
	manifest: Manifest,
	options: { maxRetries?: number; retryDelay?: number } = {},
): ResultAsync<void, ManifestError> {
	const maxRetries = options.maxRetries ?? DEFAULT_RENAME_MAX_RETRIES;
	const retryDelay = options.retryDelay ?? DEFAULT_RENAME_RETRY_DELAY_MS;

	const manifestPath = path.join(downloadPath, MANIFEST_FILENAME);
	const tempPath = path.join(downloadPath, scratchName(MANIFEST_TEMP_PREFIX));
	const json = JSON.stringify(manifest, null, 2);

	const writeAndPromote = ResultAsync.fromPromise(
		fs.promises.writeFile(tempPath, json),
		(error) => new ManifestError(`Failed to write temp manifest at ${tempPath}`, { cause: error }),
	).andThen(() =>
		move(tempPath, manifestPath, {
			maxRetries,
			retryDelay,
		}).mapErr(
			(error) =>
				new ManifestError(`Failed to rename ${tempPath} to ${manifestPath}`, { cause: error }),
		),
	);

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
