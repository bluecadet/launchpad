import { type FileHandle, mkdir, open, rm, stat } from "node:fs/promises";
import { platform } from "node:os";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import {
	type ArtifactCache,
	ArtifactCacheError,
	createArtifactCache,
} from "../cache/artifact-cache.js";
import { ContentError } from "../content-transform.js";
import { getProjectCachePaths } from "../utils/paths-helper.js";
import type { FetchStageContext } from "./fetch-context.js";

/** A durable fallback when the database cannot record source invalidation itself. */
export async function markCacheUntrusted(cwd: string): Promise<void> {
	const { directory, untrusted } = getProjectCachePaths(cwd);
	await mkdir(directory, { recursive: true });
	const file = await open(untrusted, "w", 0o600);
	try {
		await file.writeFile("Cache metadata must be discarded before reuse.\n");
		await file.sync();
	} finally {
		await file.close();
	}
	// Windows fsync uses FlushFileBuffers, which also persists file metadata:
	// https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching
	// Like SQLite's Win32 VFS, do not try to fsync a read-only directory handle.
	// On POSIX the new marker's directory entry needs its own durability barrier.
	if (platform() === "win32") return;
	const parent = await open(directory, "r");
	try {
		await parent.sync();
	} finally {
		await parent.close();
	}
}

async function clearCacheFile(filename: string): Promise<void> {
	let file: FileHandle;
	try {
		// Do not create or unlink entries: a synced in-place truncation cannot be
		// undone by a directory deletion that was not durable before a crash.
		file = await open(filename, "r+");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	try {
		await file.truncate(0);
		await file.sync();
	} finally {
		await file.close();
	}
}

async function resetUntrustedCache(cwd: string): Promise<void> {
	const { database, untrusted } = getProjectCachePaths(cwd);
	try {
		await stat(untrusted);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	// Only called with the project lease held and SQLite closed. Clear recovery files
	// first so neither WAL nor rollback recovery can restore stale metadata. Keep the
	// marker until every truncation is durable; a crash before its removal retries.
	for (const filename of [`${database}-wal`, `${database}-shm`, `${database}-journal`, database]) {
		await clearCacheFile(filename);
	}
	// Removal need not be durable: a reappearing marker only causes another reset.
	// The permanent lease is outside this directory and is never removed.
	await rm(untrusted);
}

export async function openRunCache(
	cwd: string,
	logger: Logger,
	previousRoot: (sourceId: string) => string | undefined,
	stagedRoot: (sourceId: string) => string,
): Promise<ArtifactCache> {
	await resetUntrustedCache(cwd);
	return createArtifactCache({
		databasePath: getProjectCachePaths(cwd).database,
		previousRoot,
		stagedRoot,
		warn: (message, error) => logger.warn(message, error),
	});
}

/** Must finish before any flat replacement or version promotion can start. */
export async function beginCachePublication(context: FetchStageContext): Promise<void> {
	try {
		await context.cache.beginPublication(context.sources.map((source) => source.id));
	} catch (error) {
		if (!(error instanceof ArtifactCacheError) || error.code !== "unavailable") {
			throw error;
		}
		context.logger.warn("Could not journal cache publication; publishing uncached", error);
		try {
			await markCacheUntrusted(context.cwd);
		} catch (cause) {
			throw new ContentError("Cannot safely invalidate artifact cache before publication", {
				cause,
			});
		}
	}
}

/** Cleanup/restore can still fail after promotion, so this is the pipeline's last step. */
export async function commitCachePublication(context: FetchStageContext): Promise<void> {
	if (!context.cache.available) return;
	if (
		context.publication.status !== "published" &&
		context.publication.status !== "cleaning-backups"
	)
		return;
	const roots = context.publication.receipt.finalRoots;
	try {
		await context.cache.commitPublication((sourceId) => {
			const root = roots.get(sourceId);
			if (!root) throw new ContentError(`Published root missing for ${sourceId}`);
			return root;
		});
	} catch (error) {
		// beginPublication's durable unsafe journal remains authoritative. Do not restore
		// published files merely because optional metadata could not be committed.
		context.logger.warn("Could not commit artifact cache; next fetch will regenerate", error);
	}
}

export async function closeRunCache(cache: ArtifactCache, logger: Logger): Promise<void> {
	try {
		await cache.close();
	} catch (error) {
		logger.warn("Could not close artifact cache", error);
	}
}
