/**
 * Versioned-output model: staged-root promotion into `versions/<versionId>/`, plus the manifest
 * swap that is the sole commit point for a versioned fetch.
 *
 * On a successful fetch, `promoteVersioned` moves the entire staged downloads root into a fresh
 * `versions/<versionId>/` directory in one move, then calls `ManifestUtils.writeManifest` to
 * atomically repoint `manifest.json` at it. Nothing before that rename is visible to readers;
 * nothing after it can roll back the active version. That's why the manifest write, not the
 * directory move, is what "committing" a version means.
 *
 * `FetchStageContext.attemptedVersionPath` is the handoff between `promoteVersioned` and
 * `errorRecoveryStage` (via `cleanupOrphanedVersion`) for that half-committed window: it's set to
 * the version directory's absolute path right before the move, and cleared once `writeManifest`
 * succeeds. If a later, unrelated stage fails after that point, the marker is already `undefined`
 * so error recovery won't delete the now-active, manifest-referenced version. If the run fails
 * before the marker is cleared, `cleanupOrphanedVersion` best-effort deletes the orphaned
 * directory; the retention sweep is the backstop for anything a failed delete leaves behind.
 *
 * `readActiveVersionManifest` and `resolveVersionedSeedPath` serve the other half of versioned output:
 * seeding a fresh staged directory from the *active* version (per the manifest), never from
 * "newest dir on disk", so a never-promoted orphan can't be used as a seed.
 */

import path from "node:path";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { ContentError } from "../content-transform.js";
import type { Manifest } from "../manifest.js";
import * as ManifestUtils from "../manifest.js";
import { REMOVE_MAX_RETRIES, REMOVE_RETRY_DELAY_MS } from "../retention-sweep.js";
import * as FileUtils from "../utils/file-utils.js";
import type { FetchStageContext } from "./fetch-context.js";

/**
 * Reads `manifest.json` once per `clearOldDataStage` call under versioning, warning a single
 * time if it's missing or unreadable so per-source seeding can degrade to empty without
 * repeating the warning for every source.
 */
export function readActiveVersionManifest(
	context: FetchStageContext,
): ResultAsync<Manifest | undefined, never> {
	const publishedRoot = context.paths.getPublishedDownloadPath();

	return ResultAsync.fromSafePromise(ManifestUtils.readManifest(publishedRoot)).map((result) => {
		if (result.status === "ok") {
			return result.manifest;
		}

		if (result.status === "missing") {
			context.logger.warn(
				`No manifest found at ${publishedRoot}; seeding staged directories empty for this fetch.`,
			);
		} else {
			context.logger.warn(
				`Failed to read manifest at ${publishedRoot}: ${result.error.message}; seeding staged directories empty for this fetch.`,
			);
		}

		return undefined;
	});
}

/**
 * Resolves the directory `clearOldDataStage` should seed keep-matching files from under
 * versioning: the active version's directory for this source, resolved via the manifest's
 * `sources[].path`.
 */
export function resolveVersionedSeedPath(
	context: FetchStageContext,
	sourceId: string,
	activeManifest: Manifest | undefined,
): ResultAsync<string | undefined, FileUtils.FileUtilsError> {
	if (!activeManifest) {
		return okAsync(undefined);
	}

	const manifestSource = activeManifest.sources.find((source) => source.sourceId === sourceId);
	if (!manifestSource) {
		context.logger.warn(
			`Active version ${activeManifest.versionId} has no entry for source ${sourceId}; seeding staged directory empty.`,
		);
		return okAsync(undefined);
	}

	const versionSourcePath = path.join(
		context.paths.getPublishedDownloadPath(),
		activeManifest.versionPath,
		manifestSource.path,
	);

	return FileUtils.pathExists(versionSourcePath).andThen((exists) => {
		if (!exists) {
			context.logger.warn(
				`Active version directory not found at ${versionSourcePath}; seeding staged directory for ${sourceId} empty.`,
			);
			return okAsync(undefined);
		}
		return okAsync(versionSourcePath);
	});
}

/**
 * Upper bound on same-second version-id suffixes before promotion gives up. `mintVersionId` is
 * second-granular, so two promotions in the same UTC second mint the same base id; 100 of them
 * inside one second is absurd, so exhausting the range is treated as a fault rather than looped.
 */
const MAX_VERSION_SUFFIX = 99;

/**
 * Resolves a version id whose directory does not yet exist under `versions/`. Because
 * `mintVersionId` is second-granular, two promotions in the same UTC second would otherwise
 * collide on the same id; this bumps to a zero-padded suffix (`<id>-01`, `<id>-02`, ...) that
 * sorts lexically after the bare id and before the next second's id, so retention's
 * newest-by-name ordering is preserved. Choosing a free id up front also guarantees the
 * subsequent move never lands on an existing directory, so neither a rename `ENOTEMPTY` nor
 * `move`'s cross-device copy fallback can touch a live, manifest-referenced version.
 */
function resolveFreeVersionId(
	publishedRoot: string,
	baseId: string,
	attempt = 0,
): ResultAsync<string, FileUtils.FileUtilsError> {
	const candidateId = attempt === 0 ? baseId : `${baseId}-${FileUtils.pad(attempt, 2)}`;
	const candidatePath = path.join(publishedRoot, "versions", candidateId);

	return FileUtils.pathExists(candidatePath).andThen((exists) => {
		if (!exists) {
			return okAsync(candidateId);
		}
		if (attempt >= MAX_VERSION_SUFFIX) {
			return errAsync(
				new FileUtils.FileUtilsError(
					`Exhausted same-second version-id suffixes for ${baseId} under ${publishedRoot}`,
				),
			);
		}
		return resolveFreeVersionId(publishedRoot, baseId, attempt + 1);
	});
}

/**
 * Promotes the entire staged downloads root into a fresh `versions/<versionId>/` directory
 * in a single move, then atomically swaps the manifest to point at it. See the module doc
 * comment for the commit-point and `attemptedVersionPath` handoff contract.
 */
export function promoteVersioned(context: FetchStageContext): ResultAsync<void, ContentError> {
	const stagedRoot = context.paths.getStagedDownloadPath();
	const publishedRoot = context.paths.getPublishedDownloadPath();

	return FileUtils.pathExists(stagedRoot)
		.andThen((exists) => {
			if (!exists) {
				return okAsync(undefined);
			}

			return resolveFreeVersionId(publishedRoot, ManifestUtils.mintVersionId()).andThen(
				(versionId) => {
					const versionRelativePath = path.posix.join("versions", versionId);
					const versionAbsolutePath = path.join(publishedRoot, "versions", versionId);

					// Mark the chosen path as this run's attempt only after resolving a free id, so
					// error recovery can only ever delete the directory this run is about to create --
					// never a pre-existing, manifest-referenced version that minted the same base id.
					context.attemptedVersionPath = versionAbsolutePath;

					return FileUtils.move(stagedRoot, versionAbsolutePath).andThen(() => {
						const generatedAt = new Date().toISOString();
						const manifest: Manifest = {
							schemaVersion: ManifestUtils.MANIFEST_SCHEMA_VERSION,
							versionId,
							versionPath: versionRelativePath,
							generatedAt,
							sources: context.sources.map((source) => ({ sourceId: source.id, path: source.id })),
						};

						return ManifestUtils.writeManifest(publishedRoot, manifest).andTee(() => {
							// Committed: clear the attempt marker so a later, unrelated stage failure
							// (e.g. cleanupStage) can't cause error recovery to delete the now-active,
							// manifest-referenced version.
							context.attemptedVersionPath = undefined;
							context.eventBus?.emit("content:version:promoted", {
								versionId,
								versionPath: versionRelativePath,
								generatedAt,
							});
						});
					});
				},
			);
		})
		.mapErr((error) => new ContentError("Failed to promote versioned output", { cause: error }));
}

/**
 * Best-effort delete of the version dir this run tried to create, for the versioned-output
 * error path. See the module doc comment for the `attemptedVersionPath` handoff contract.
 */
export function cleanupOrphanedVersion(context: FetchStageContext): ResultAsync<void, never> {
	const versionPath = context.attemptedVersionPath;
	if (!versionPath) {
		return okAsync(undefined);
	}

	return FileUtils.remove(versionPath, {
		maxRetries: REMOVE_MAX_RETRIES,
		retryDelay: REMOVE_RETRY_DELAY_MS,
	}).orElse((error) => {
		context.logger.warn(
			`Failed to remove orphaned version directory ${versionPath}: ${error.message}`,
		);
		return okAsync(undefined);
	});
}
