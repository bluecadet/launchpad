/**
 * Fetch pipeline stages as simple functions.
 * Each stage is responsible for one phase of the fetch lifecycle.
 *
 * Stages are composed in LaunchpadContent._executeFetchPipeline.
 */

import chalk from "chalk";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { ContentError } from "../content-plugin.js";
import type { ContentSource } from "../source.js";
import { FetchLogger } from "../utils/fetch-logger.js";
import * as FileUtils from "../utils/file-utils.js";
import type { FetchStageContext } from "./fetch-context.js";

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
 * Stage 1: Run setup hooks.
 * Sources are already resolved before the pipeline starts.
 */
export function setupHooksStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.verbose("Beginning phase: running-setup-hooks");
	return context.pluginDriver
		.runHookSequential("onContentFetchSetup")
		.mapErr(
			(e) => new ContentError("Failed to run plugin onContentFetchSetup hooks", { cause: e }),
		);
}

/**
 * Stage 2: Back up existing downloads (optional).
 */
export function backupStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	const backupRequired = context.config.backupAndRestore;
	if (!backupRequired) {
		return okAsync(undefined);
	}

	context.logger.verbose("Beginning phase: backing-up");

	context.logger.info("Backing up downloads...");

	if (!context.sources) {
		return errAsync(new ContentError("Sources not initialized"));
	}

	return ResultAsync.combine(
		context.sources.map((source) => {
			const downloadPath = context.getDownloadPath(source.id);
			const backupPath = context.getBackupPath(source.id);

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
	context.logger.verbose("Beginning phase: clearing-old-data");

	context.logger.info("Clearing download directory");

	if (!context.sources) {
		return errAsync(new ContentError("Sources not initialized"));
	}

	return ResultAsync.combine(
		context.sources.map((source) =>
			FileUtils.clearDir(context.getDownloadPath(source.id), {
				keepPatterns: context.config.keep,
				ignoreKeep: false,
				removeIfEmpty: false,
			}),
		),
	).map(() => undefined);
}

/**
 * Stage 4: Fetch all sources in parallel.
 */
export function fetchSourcesStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.verbose("Beginning phase: fetching-sources");

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
						return new ContentFetchError(`Failed to fetch source ${source.id}`, source.id, e);
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
				.safeInsert(req.id, req.data)
				.andTee(() => {
					// Emit document:write event on success
					// Construct the file path (Documents don't expose their path)
					const filename = req.id.includes(".") ? req.id : `${req.id}.json`;
					const filePath = `${context.getDownloadPath(source.id)}/${filename}`;
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
 * Stage 5: Run done hooks.
 */
export function doneHooksStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.verbose("Beginning phase: running-done-hooks");

	return context.pluginDriver
		.runHookSequential("onContentFetchDone")
		.mapErr((e) => new ContentError("Failed to run plugin onContentFetchDone hooks", { cause: e }));
}

/**
 * Stage 6: Finalize (success path).
 */
export function finalizingStage(context: FetchStageContext): ResultAsync<void, ContentError> {
	context.logger.verbose("Beginning phase: finalizing");

	context.eventBus?.emit("content:fetch:done", {
		sources: context.sources?.map((s) => s.id) || [],
	});

	return ResultAsync.fromPromise(
		context.dataStore.close(),
		(error) => new ContentError("Failed to close data store", { cause: error }),
	);
}

/**
 * Stage 7: Handle errors and optionally restore from backup.
 */
export const errorRecoveryStage = (
	context: FetchStageContext,
	error: ContentError,
): ResultAsync<void, ContentError | ContentRecoveryError> => {
	context.logger.verbose("Beginning phase: error-recovery");
	context.logger.error("Error in content fetch process. Running recovery steps...");

	context.eventBus?.emit("content:fetch:error", { error });

	return okAsync()
		.andTee(() =>
			context.pluginDriver
				.runHookSequential("onContentFetchError", error)
				.mapErr(
					(e) => new ContentError("Failed to run plugin onContentFetchError hooks", { cause: e }),
				),
		)
		.andTee(() => {
			context.logger.info("Restoring from backup...");
		})
		.andThen(
			() =>
				ResultAsync.combine(
					context.sources.map((source) => {
						const downloadPath = context.getDownloadPath(source.id);
						const backupPath = context.getBackupPath(source.id);

						return FileUtils.pathExists(backupPath)
							.andThen((exists) => {
								if (!exists) {
									context.logger.warn(`No backup found for ${source.id}`);
									return okAsync(undefined);
								}

								context.logger.info(`Restoring ${chalk.white(source.id)} from backup`);
								return FileUtils.copy(backupPath, downloadPath, {
									preserveTimestamps: true,
								}).mapErr(
									(e) => new ContentRecoveryError(`Failed to restore ${source.id}`, error, e),
								);
							})
							.mapErr((e) => new ContentRecoveryError(`Restore failed for ${source.id}`, error, e));
					}),
				).map(() => undefined), // return void instead of void[]
		);
};

/**
 * Stage 7 (Final): Clean up temporary and backup directories.
 */
export const cleanupStage = (
	context: FetchStageContext,
	cleanup: { temp?: boolean; backups?: boolean } = {},
): ResultAsync<void, ContentError> => {
	context.logger.verbose("Beginning phase: clearing-temp");

	if (!context.sources) {
		return okAsync(undefined);
	}

	const dirPaths: string[] = [];

	if (cleanup.temp) {
		dirPaths.push(...context.sources.map((source) => context.getTempPath(source.id)));
	}

	if (cleanup.backups) {
		dirPaths.push(...context.sources.map((source) => context.getBackupPath(source.id)));
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
