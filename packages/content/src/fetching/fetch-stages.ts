/**
 * Fetch pipeline stages as simple functions.
 * Each stage is responsible for one phase of the fetch lifecycle.
 *
 * Stages are composed in LaunchpadContent._executeFetchPipeline.
 */

import path from "node:path";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import chalk from "chalk";
import { err, errAsync, okAsync, ResultAsync } from "neverthrow";
import {
	ContentError,
	type ContentTransform,
	type ContentTransformContext,
} from "../content-transform.js";
import type { Manifest } from "../manifest.js";
import * as ManifestUtils from "../manifest.js";
import { type SweepResult, sweepVersions } from "../retention-sweep.js";
import type { ContentSource } from "../source.js";
import { FetchLogger } from "../utils/fetch-logger.js";
import * as FileUtils from "../utils/file-utils.js";
import type { FetchStageContext } from "./fetch-context.js";

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

/**
 * Resolves the directory `clearOldDataStage` should seed keep-matching files from. Off
 * versioning, that's today's published source path. Under versioning, it's the active
 * version's directory for this source, resolved via the manifest's `sources[].path` — never
 * "newest dir on disk" — so a never-promoted orphan can't be used as a seed.
 */
function resolveSeedPath(
	context: FetchStageContext,
	sourceId: string,
	activeManifest: Manifest | undefined,
): ResultAsync<string | undefined, FileUtils.FileUtilsError> {
	if (!context.config.versioning) {
		return okAsync(context.paths.getPublishedDownloadPath(sourceId));
	}

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

function prepareStagedSourceDirectory(
	context: FetchStageContext,
	sourceId: string,
	activeManifest: Manifest | undefined,
): ResultAsync<void, ContentError> {
	const stagedPath = context.paths.getStagedDownloadPath(sourceId);

	return resolveSeedPath(context, sourceId, activeManifest)
		.andThen((seedPath) =>
			FileUtils.clearDir(stagedPath, {
				ignoreKeep: true,
				removeIfEmpty: true,
			})
				.andThen(() => FileUtils.ensureDir(stagedPath))
				.andThen(() =>
					seedPath
						? FileUtils.copyMatchingFiles(seedPath, stagedPath, context.config.keep)
						: okAsync(undefined),
				),
		)
		.mapErr(
			(error) =>
				new ContentError(`Failed to prepare staged directory for ${sourceId}`, { cause: error }),
		);
}

function promoteStagedSourceDirectory(
	context: FetchStageContext,
	sourceId: string,
): ResultAsync<void, ContentError> {
	const stagedPath = context.paths.getStagedDownloadPath(sourceId);
	const publishedPath = context.paths.getPublishedDownloadPath(sourceId);
	const publishedParentPath = context.paths.getPublishedDownloadPath();
	const rollbackDir = context.paths.getRunPath(".promotion-rollback");

	return FileUtils.pathExists(stagedPath)
		.andThen((exists) => {
			if (!exists) {
				return okAsync(undefined);
			}

			return FileUtils.ensureDir(publishedParentPath).andThen(() =>
				FileUtils.replacePath(stagedPath, publishedPath, {
					preserveTimestamps: true,
					rollbackDir,
				}),
			);
		})
		.mapErr(
			(error) =>
				new ContentError(`Failed to promote staged directory for ${sourceId}`, { cause: error }),
		);
}

function promoteStagedRootEntries(context: FetchStageContext): ResultAsync<void, ContentError> {
	const stagedRoot = context.paths.getStagedDownloadPath();
	const publishedRoot = context.paths.getPublishedDownloadPath();
	const rollbackDir = context.paths.getRunPath(".promotion-rollback");
	const sourceIds = new Set(context.sources.map((source) => source.id));

	return FileUtils.pathExists(stagedRoot)
		.andThen((exists) => {
			if (!exists) {
				return okAsync(undefined);
			}

			return FileUtils.listDir(stagedRoot).andThen((entries) => {
				const rootEntries = entries.filter((entry) => !sourceIds.has(entry));
				if (rootEntries.length === 0) {
					return okAsync(undefined);
				}

				return FileUtils.ensureDir(publishedRoot).andThen(() =>
					ResultAsync.combine(
						rootEntries.map((entry) =>
							FileUtils.replacePath(
								context.paths.getRunPath("downloads", entry),
								context.paths.getPublishedDownloadPath(entry),
								{
									preserveTimestamps: true,
									rollbackDir,
								},
							),
						),
					).map(() => undefined),
				);
			});
		})
		.mapErr(
			(error) => new ContentError("Failed to promote staged root-level content", { cause: error }),
		);
}

/**
 * Promotes the entire staged downloads root into a fresh `versions/<versionId>/` directory
 * in a single move, then atomically swaps the manifest to point at it. The manifest rename
 * is the sole commit point; any failure before it leaves the active version untouched.
 */
function promoteVersioned(context: FetchStageContext): ResultAsync<void, ContentError> {
	const stagedRoot = context.paths.getStagedDownloadPath();
	const publishedRoot = context.paths.getPublishedDownloadPath();
	const versionId = ManifestUtils.mintVersionId();
	const versionRelativePath = path.posix.join("versions", versionId);
	const versionAbsolutePath = path.join(publishedRoot, "versions", versionId);

	context.attemptedVersionPath = versionAbsolutePath;

	return FileUtils.pathExists(stagedRoot)
		.andThen((exists) => {
			if (!exists) {
				return okAsync(undefined);
			}

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
		})
		.mapErr((error) => new ContentError("Failed to promote versioned output", { cause: error }));
}

/**
 * Best-effort delete of the version dir this run tried to create, for the versioned-output
 * error path. The retention sweep is the backstop for anything left behind by a failed delete.
 */
function cleanupOrphanedVersion(context: FetchStageContext): ResultAsync<void, never> {
	const versionPath = context.attemptedVersionPath;
	if (!versionPath) {
		return okAsync(undefined);
	}

	return FileUtils.remove(versionPath).orElse((error) => {
		context.logger.warn(
			`Failed to remove orphaned version directory ${versionPath}: ${error.message}`,
		);
		return okAsync(undefined);
	});
}

export type { FetchStageContext } from "./fetch-context.js";

/**
 * Error thrown during fetching of a specific source.
 */
export class ContentFetchError extends ContentError {
	constructor(
		message: string,
		public sourceId: string,
		cause?: Error,
	) {
		super(message, { cause });
		this.name = "ContentFetchError";
	}
}

/**
 * Error thrown during recovery process.
 */
export class ContentRecoveryError extends ContentError {
	constructor(
		message: string,
		public originalError: ContentError,
		cause?: Error,
	) {
		super(message, { cause });
		this.name = "ContentRecoveryError";
	}
}

/**
 * Stage 2: Back up existing downloads (optional).
 */
export function backupStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	// Superseded under versioning: retained version dirs are strictly better backups, and the
	// active version is never touched mid-fetch, so there's nothing to protect. Silent, since
	// `backupAndRestore` defaults to true and a warning would fire for every versioned config.
	const backupRequired = context.config.backupAndRestore && !context.config.versioning;
	if (!backupRequired) {
		return okAsync(undefined);
	}

	context.logger.debug("Beginning phase: backing-up");

	context.logger.info("Backing up downloads...");

	if (!context.sources) {
		return errAsync(new ContentError("Sources not initialized"));
	}

	return ResultAsync.combine(
		context.sources.map((source) => {
			const downloadPath = context.paths.getPublishedDownloadPath(source.id);
			const backupPath = context.paths.getBackupPath(source.id);

			return FileUtils.pathExists(downloadPath)
				.andThen((exists) => {
					if (!exists) {
						context.logger.warn(
							`Skipping backup for ${source.id}: No downloads found at ${downloadPath}`,
						);
						return okAsync(undefined);
					}

					context.logger.info(`Backing up source: ${source.id}`);
					return FileUtils.copy(downloadPath, backupPath);
				})
				.mapErr((e) => new ContentError("Failed to backup sources", { cause: e }));
		}),
	).map(() => undefined);
}

/**
 * Stage 3: Clear old downloads.
 */
export function clearOldDataStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.debug("Beginning phase: clearing-old-data");

	context.logger.info("Preparing staged download directory");

	if (!context.sources) {
		return errAsync(new ContentError("Sources not initialized"));
	}

	const activeManifest = context.config.versioning
		? readActiveVersionManifest(context)
		: okAsync(undefined);

	return activeManifest.andThen((manifest) =>
		ResultAsync.combine(
			context.sources.map((source) => prepareStagedSourceDirectory(context, source.id, manifest)),
		).map(() => undefined),
	);
}

/**
 * Stage 4: Fetch all sources in parallel.
 */
export function fetchSourcesStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.debug("Beginning phase: fetching-sources");

	if (!context.sources || context.sources.length === 0) {
		context.logger.warn("No sources found to download");
		return okAsync(undefined);
	}

	context.logger.info("Beginning content fetch process");
	context.logger.info(
		`Fetching ${context.sources.length} source(s): ${context.sources.map((s) => s.id).join(", ")}`,
	);

	const fetchLogger = new FetchLogger(context.logger, context.eventBus);

	return ResultAsync.combine(
		// eagerly instantiate all namespaces, that way a source can depend on another source's data
		// with the Namespace.waitFor API
		context.sources.map((source) => context.dataStore.createNamespace(source.id)),
	).andThen(
		() =>
			ResultAsync.combine(
				context.sources.map((source) =>
					_fetchSource(source, context, fetchLogger).mapErr((e) => {
						const error = new ContentFetchError(
							`Failed to fetch source ${source.id}`,
							source.id,
							e,
						);
						context.eventBus?.emit("content:source:error", { sourceId: source.id, error });
						return error;
					}),
				),
			)
				.andTee(() => {
					fetchLogger.close();
					context.logger.info("Fetch completed.");

					// Emit fetch:done event for each successful fetch
					for (const source of context.sources) {
						context.eventBus?.emit("content:source:done", {
							sourceId: source.id,
						});
					}
				})
				.orTee(() => {
					// On error, still close the logger
					fetchLogger.close();
				})
				.map(() => undefined), // return void
	);
}

function _fetchSource(source: ContentSource, context: FetchStageContext, fetchLogger: FetchLogger) {
	context.eventBus?.emit("content:source:start", {
		sourceId: source.id,
		sourceType: (source as { type?: string }).type || "unknown",
	});

	return context.dataStore.namespace(source.id).asyncAndThen((namespace) => {
		const fetchResult = source.fetch(context);
		const fetchArray = Array.isArray(fetchResult) ? fetchResult : [fetchResult];

		const insertResults = fetchArray.map((req) => {
			const insertResultAsync = namespace
				.insert(req.id, req.data)
				.andTee(() => {
					// Emit document:write event on success
					// Construct the file path (Documents don't expose their path)
					const filename = req.id.includes(".") ? req.id : `${req.id}.json`;
					const filePath = `${context.paths.getStagedDownloadPath(source.id)}/${filename}`;
					context.eventBus?.emit("content:document:write", {
						sourceId: source.id,
						documentId: req.id,
						path: filePath,
					});
				})
				.mapErr((e) => {
					// Emit document:error event on failure
					context.eventBus?.emit("content:document:error", {
						sourceId: source.id,
						documentId: req.id,
						error: e,
					});
					return new ContentError(`Failed to write data for ${req.id}`, e);
				});

			fetchLogger.addFetch(source.id, req.id, insertResultAsync);

			return insertResultAsync;
		});

		return ResultAsync.combine(insertResults);
	});
}

/**
 * Stage 5: Run content transforms sequentially.
 * Each transform's temp path is namespaced to the transform name.
 */
export function runTransformsStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	if (context.transforms.length === 0) {
		return okAsync(undefined);
	}

	context.logger.debug("Beginning phase: running-transforms");

	const baseCtx = {
		data: context.dataStore,
		logger: context.logger,
		contentOptions: context.config,
		eventBus: context.eventBus,
		abortSignal: context.abortSignal,
		cwd: context.cwd,
	};

	return context.transforms.reduce(
		(chain: ResultAsync<void, ContentError>, transform: ContentTransform) =>
			chain.andThen(() => {
				const startTime = Date.now();
				context.eventBus.emit("content:transform:start", { transformName: transform.name });

				const transformCtx: ContentTransformContext = {
					...baseCtx,
					paths: {
						...context.paths,
						// Bind transform.name into getTempPath for namespace isolation
						getTempPath: (source?: string) => context.paths.getTempPath(source, transform.name),
					},
				};

				return ResultAsync.fromPromise(
					transform.apply(transformCtx),
					(e) =>
						new ContentError(`Transform "${transform.name}" failed`, {
							cause: ensureError(e),
						}),
				)
					.andTee(() => {
						context.eventBus.emit("content:transform:done", {
							transformName: transform.name,
							duration: Date.now() - startTime,
						});
					})
					.orElse((error) => {
						context.eventBus.emit("content:transform:error", {
							transformName: transform.name,
							error,
						});
						return err(error);
					});
			}),
		okAsync<void, ContentError>(undefined),
	);
}

/**
 * Stage 6: Finalize (success path).
 */
export function finalizingStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.debug("Beginning phase: finalizing");

	return context.dataStore
		.close()
		.mapErr((e) => new ContentError("Failed to close data store", { cause: e }))
		.andThen(() => {
			if (!context.sources) {
				return okAsync(undefined);
			}

			if (context.config.versioning) {
				return promoteVersioned(context);
			}

			return ResultAsync.combine(
				context.sources.map((source) => promoteStagedSourceDirectory(context, source.id)),
			)
				.map(() => undefined)
				.andThen(() => promoteStagedRootEntries(context));
		})
		.andTee(() => {
			context.eventBus?.emit("content:fetch:done", {
				sources: context.sources?.map((s) => s.id) || [],
			});
		});
}

/**
 * Stage 6 (Versioned only): keep-N retention sweep of `versions/`, run once per successful
 * versioned fetch. A no-op (resolves `undefined`) with versioning off. Never fails the fetch:
 * a version dir that can't be fully removed is left in place and reported as pending-delete,
 * to be retried on the next sweep.
 */
export function sweepStage(
	context: FetchStageContext,
): ResultAsync<SweepResult | undefined, never> {
	context.logger.debug("Beginning phase: sweeping-versions");

	if (!context.config.versioning) {
		return okAsync(undefined);
	}

	const downloadPath = context.paths.getPublishedDownloadPath();
	return sweepVersions(downloadPath, context.config.versioning, context.logger);
}

/**
 * Stage 7: Handle errors and optionally restore from backup.
 */
export const errorRecoveryStage = (
	context: FetchStageContext,
	error: ContentError,
): ResultAsync<{ restoredSourceIds: string[] }, ContentError | ContentRecoveryError> => {
	context.logger.debug("Beginning phase: error-recovery");
	context.logger.error("Error in content fetch process. Running recovery steps...");

	context.eventBus?.emit("content:fetch:error", { error });

	// Superseded under versioning: the active version was never touched, so there's nothing to
	// restore. Instead, best-effort delete the version dir this run tried to create.
	if (context.config.versioning) {
		return cleanupOrphanedVersion(context).map(() => ({ restoredSourceIds: [] }));
	}

	if (!context.config.backupAndRestore) {
		return okAsync({ restoredSourceIds: [] });
	}

	return okAsync()
		.andTee(() => {
			context.logger.info("Restoring from backup...");
		})
		.andThen(() =>
			ResultAsync.combine(
				context.sources.map((source) => {
					const downloadPath = context.paths.getPublishedDownloadPath(source.id);
					const backupPath = context.paths.getBackupPath(source.id);

					return FileUtils.pathExists(backupPath)
						.andThen((exists) => {
							if (!exists) {
								context.logger.warn(`No backup found for ${source.id}`);
								return okAsync<string | undefined>(undefined);
							}

							context.logger.info(`Restoring ${chalk.white(source.id)} from backup`);
							return FileUtils.remove(downloadPath)
								.andThen(() =>
									FileUtils.copy(backupPath, downloadPath, {
										preserveTimestamps: true,
									}),
								)
								.map(() => source.id)
								.mapErr(
									(e) => new ContentRecoveryError(`Failed to restore ${source.id}`, error, e),
								);
						})
						.mapErr((e) => new ContentRecoveryError(`Restore failed for ${source.id}`, error, e));
				}),
			).map((restoredSourceIds) => ({
				restoredSourceIds: restoredSourceIds.filter(
					(sourceId): sourceId is string => sourceId !== undefined,
				),
			})),
		);
};

/**
 * Stage 7 (Final): Clean up temporary and backup directories.
 */
export const cleanupStage = (
	context: FetchStageContext,
	cleanup: { temp?: boolean; backups?: boolean } = {},
): ResultAsync<void, ContentError> => {
	context.logger.debug("Beginning phase: clearing-temp");

	if (!context.sources) {
		return okAsync(undefined);
	}

	const dirPaths: string[] = [];

	if (cleanup.temp) {
		dirPaths.push(context.paths.getRunPath());
	}

	if (cleanup.backups) {
		dirPaths.push(...context.sources.map((source) => context.paths.getBackupPath(source.id)));
	}

	if (dirPaths.length === 0) {
		return okAsync(undefined);
	}

	return ResultAsync.combine(
		dirPaths.map((dirPath) =>
			FileUtils.clearDir(dirPath, {
				keepPatterns: undefined,
				ignoreKeep: true,
				removeIfEmpty: true,
			}),
		),
	).map(() => undefined);
};
