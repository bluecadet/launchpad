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
 * During promotion, PublicationState carries the attempted version path for orphan cleanup.
 * A successful manifest swap replaces that attempt with a publication receipt containing
 * explicit final roots. Later cleanup failures cannot delete a manifest-committed version.
 * The retention sweep retries any orphan whose best-effort removal failed.
 *
 * snapshotVersionedRoots validates and resolves the active manifest once for both keep-file
 * seeding and artifact reuse. Unpromoted orphan directories never become seed candidates.
 */

import path from "node:path";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { buildVersionPromotedPayload } from "../content-events.js";
import { ContentError } from "../content-transform.js";
import type { Manifest } from "../manifest.js";
import * as ManifestUtils from "../manifest.js";
import { REMOVE_MAX_RETRIES, REMOVE_RETRY_DELAY_MS } from "../retention-sweep.js";
import * as FileUtils from "../utils/file-utils.js";
import type { FetchStageContext } from "./fetch-context.js";
import type { PublicationReceipt } from "./output-strategy.js";

/**
 * Reads `manifest.json` once per `clearOldDataStage` call under versioning, warning a single
 * time if it's missing or unreadable so per-source seeding can degrade to empty without
 * repeating the warning for every source.
 */
function readActiveVersionManifest(
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

/** Snapshot all manifest roots once, validating physical separation before any seed copies. */
export function snapshotVersionedRoots(
	context: FetchStageContext,
): ResultAsync<ReadonlyMap<string, string>, FileUtils.FileUtilsError> {
	return readActiveVersionManifest(context).andThen((manifest) => {
		if (!manifest) return okAsync(new Map<string, string>());
		return ResultAsync.fromPromise(
			ManifestUtils.resolveManifestSourceRoots(context.paths.getPublishedDownloadPath(), manifest),
			(error) => new FileUtils.FileUtilsError("Unsafe manifest source roots", { cause: error }),
		).andThen((roots) =>
			ResultAsync.combine(
				context.sources.map((source) => {
					const root = roots.get(source.id);
					if (!root) {
						context.logger.warn(
							`Active version ${manifest.versionId} has no entry for source ${source.id}; seeding staged directory empty.`,
						);
						return okAsync({ sourceId: source.id, root: undefined });
					}
					return FileUtils.pathExists(root).map((exists) => {
						if (!exists)
							context.logger.warn(
								`Active version directory not found at ${root}; seeding staged directory for ${source.id} empty.`,
							);
						return { sourceId: source.id, root: exists ? root : undefined };
					});
				}),
			).map(
				(sources) =>
					new Map(
						sources.flatMap(({ sourceId, root }) => (root ? [[sourceId, root] as const] : [])),
					),
			),
		);
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
 * comment for the commit-point and `orphanedVersionPath` handoff contract.
 */
export function promoteVersioned(
	context: FetchStageContext,
): ResultAsync<PublicationReceipt, ContentError> {
	const stagedRoot = context.paths.getStagedDownloadPath();
	const publishedRoot = context.paths.getPublishedDownloadPath();

	return FileUtils.pathExists(stagedRoot)
		.andThen((exists) => {
			if (!exists) {
				return errAsync(new ContentError("Staged root missing before version promotion"));
			}

			return resolveFreeVersionId(publishedRoot, ManifestUtils.mintVersionId()).andThen(
				(versionId) => {
					const versionRelativePath = path.posix.join("versions", versionId);
					const versionAbsolutePath = path.join(publishedRoot, "versions", versionId);

					// Mark the chosen path as this run's attempt only after resolving a free id, so
					// error recovery can only ever delete the directory this run is about to create --
					// never a pre-existing, manifest-referenced version that minted the same base id.
					context.publication = { status: "promoting", orphanedVersionPath: versionAbsolutePath };

					return FileUtils.move(stagedRoot, versionAbsolutePath).andThen(() => {
						const generatedAt = new Date().toISOString();
						const manifest: Manifest = {
							schemaVersion: ManifestUtils.MANIFEST_SCHEMA_VERSION,
							versionId,
							versionPath: versionRelativePath,
							generatedAt,
							sources: context.sources.map((source) => ({ sourceId: source.id, path: source.id })),
						};

						const receipt: PublicationReceipt = {
							finalRoots: new Map(
								context.sources.map((source) => [
									source.id,
									path.join(versionAbsolutePath, source.id),
								]),
							),
						};
						return ManifestUtils.writeManifest(publishedRoot, manifest).map(() => {
							context.publication = { status: "published", receipt };
							context.eventBus?.emit(
								"content:version:promoted",
								buildVersionPromotedPayload(manifest),
							);
							return receipt;
						});
					});
				},
			);
		})
		.mapErr((error) => new ContentError("Failed to promote versioned output", { cause: error }));
}

/**
 * Best-effort delete of the version dir this run tried to create, for the versioned-output
 * error path. See the module doc comment for the `orphanedVersionPath` handoff contract.
 */
export function cleanupOrphanedVersion(context: FetchStageContext): ResultAsync<void, never> {
	const versionPath =
		context.publication.status === "promoting"
			? context.publication.orphanedVersionPath
			: undefined;
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
