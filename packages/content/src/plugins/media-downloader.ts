import { setMaxListeners } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { FixedConsoleLogger, type Logger } from "@bluecadet/launchpad-utils";
import chalk from "chalk";
import { JSONPath } from "jsonpath-plus";
import { ResultAsync, errAsync, ok, okAsync } from "neverthrow";
import { z } from "zod";
import { type ContentHookContext, defineContentPlugin } from "../content-plugin-driver.js";
import type { DataKeys, DataStore } from "../utils/data-store.js";
import * as FileUtils from "../utils/file-utils.js";
import ResultAsyncQueue from "../utils/result-async-queue.js";
import { safeKy } from "../utils/safe-ky.js";
import { parsePluginConfig } from "./contentPluginHelpers.js";

const DEFAULT_MEDIA_PATTERN = /\.(jpg|jpeg|png|webp|avi|mov|mp4|mpg|mpeg|webm)$/i;

/**
 * @internal
 */
export const mediaDownloaderConfigSchema = z.object({
	/** Data keys to search for media urls. If not provided, all keys will be searched. */
	keys: z
		.array(z.string())
		.optional()
		.describe("Data keys to search for media urls. If not provided, all keys will be searched."),
	/** Regex to match urls to download. */
	mediaPattern: z
		.instanceof(RegExp)
		.describe("Regex to match urls to download.")
		.default(DEFAULT_MEDIA_PATTERN),
	/** JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`. */
	matchPath: z
		.string()
		.optional()
		.describe(
			"JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`.",
		),
	/** Number of concurrent downloads */
	maxConcurrent: z.number().int().positive().describe("Number of concurrent downloads").default(4),
	/** Will always download files regardless of whether they've been cached. Defaults to false. */
	ignoreCache: z
		.boolean()
		.describe("Will always download files regardless of whether they've been cached.")
		.default(false),
	/** Enables the HTTP if-modified-since check. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true. */
	enableIfModifiedSinceCheck: z
		.boolean()
		.describe(
			"Enables the HTTP if-modified-since check. Disabling this will assume that the local file is the same as the remote file if it already exists.",
		)
		.default(true),
	/** Compares the HTTP header content-length with the local file size. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true. */
	enableContentLengthCheck: z
		.boolean()
		.describe(
			"Compares the HTTP header content-length with the local file size. Disabling this will assume that the local file is the same as the remote file if it already exists.",
		)
		.default(true),
	/** Clear the temp dir before starting downloads. This means the cache will be ignored. Defaults to false. */
	forceClearTempFiles: z
		.boolean()
		.describe("Clear the temp dir before starting downloads. This means the cache will be ignored.")
		.default(false),
	/** Function to transform the local path of the downloaded file. */
	transformLocalPath: z
		.function(z.tuple([z.string()]), z.string())
		.describe("Function to transform the local path of the downloaded file.")
		.optional(),
	/** Maximum timeout for the HTTP request. Defaults to 10 seconds. */
	maxTimeout: z
		.number()
		.int()
		.positive()
		.describe("Maximum timeout for the HTTP request.")
		.default(10000),
	/** If true, the queue will stop and throw an error if any of the media requests fail. If false, the queue will continue to download the remaining files and log all errors, but not throw. Defaults to true. */
	abortOnError: z
		.boolean()
		.describe(
			"If true, the queue will stop and throw an error if any of the media requests fail. If false, the queue will continue to download the remaining files and log all errors, but not throw.",
		)
		.default(true),
});

type MediaDownloaderConfigWithDefaults = z.infer<typeof mediaDownloaderConfigSchema>;

export function localFilePathFromUrl(url: string) {
	let urlPath = url.replace(/^[^:]+:\/\/[^/]+/, "");
	if (urlPath.startsWith("/")) {
		urlPath = urlPath.slice(1);
	}
	return urlPath.replace(/\//g, path.sep);
}

export function checkCacheStatus(
	url: string,
	backupPath: string,
	abortSignal: AbortSignal,
	config: Pick<
		MediaDownloaderConfigWithDefaults,
		"ignoreCache" | "enableIfModifiedSinceCheck" | "enableContentLengthCheck" | "maxTimeout"
	>,
) {
	return FileUtils.pathExists(backupPath)
		.mapErr((err) => new FileSystemError("Failed to check if file exists", err))
		.andThen((exists) =>
			exists
				? ResultAsync.fromPromise(
						fs.promises.lstat(backupPath),
						(err) => new FileSystemError(`Failed to get file stats for ${backupPath}`, err),
					)
				: okAsync(null),
		)
		.map((stats) => {
			if (config.ignoreCache || !stats || !stats.isFile()) {
				return { shouldDownload: true };
			}

			if (!config.enableIfModifiedSinceCheck && !config.enableContentLengthCheck) {
				return { shouldDownload: true };
			}

			return { shouldDownload: false, existingFile: backupPath, stats };
		})
		.andThen((result) => {
			if (result.shouldDownload || !result.stats) {
				return okAsync(result);
			}

			return safeKy(url, {
				method: "HEAD",
				signal: abortSignal,
				timeout: config.maxTimeout,
				throwHttpErrors: false,
				headers: {
					"If-Modified-Since": result.stats.mtime.toUTCString(),
				},
			})
				.mapErr((err) => new NetworkError(`Failed to check cache status for ${url}`, err))
				.map((res) => {
					let isRemoteNew = true;

					if (config.enableIfModifiedSinceCheck) {
						isRemoteNew = res.status !== 304;
					}

					// only check content length if the response says it's new
					if (isRemoteNew && config.enableContentLengthCheck) {
						const remoteSize = Number.parseInt(res.headers.get("content-length") ?? "");
						const localSize = result.stats.size;
						isRemoteNew = isRemoteNew || remoteSize !== localSize;
					}

					return {
						shouldDownload: isRemoteNew,
						existingFile: result.existingFile,
						stats: result.stats,
					};
				});
		});
}

export function downloadFile(
	url: string,
	filePath: string,
	abortSignal: AbortSignal,
	config: MediaDownloaderConfigWithDefaults,
): ResultAsync<void, FileSystemError | NetworkError> {
	return safeKy(url, {
		signal: abortSignal,
		timeout: config.maxTimeout,
	})
		.mapErr((err) => new NetworkError(`Failed to download ${url}`, err))
		.andThen((res) => {
			if (!res.body) {
				return errAsync(new Error("No response body"));
			}

			const writer = fs.createWriteStream(filePath);
			return ResultAsync.fromPromise(
				pipeline(res.body, writer),
				(err) => new FileSystemError(`Failed to write file: ${err}`, err),
			);
		});
}

function downloadMedia(
	url: string,
	destDir: string,
	backupDir: string,
	encodeRegex: RegExp,
	abortSignal: AbortSignal,
	config: MediaDownloaderConfigWithDefaults,
): ResultAsync<
	{ cacheHit: boolean; destPath: string },
	FileSystemError | NetworkError | CacheError
> {
	const transformFn = config.transformLocalPath ?? ((path) => path);
	const localPath = transformFn(localFilePathFromUrl(url)).replace(encodeRegex, encodeURIComponent);

	const destPath = path.join(destDir, localPath);
	const backupPath = path.join(backupDir, localPath);
	const destPathDir = path.dirname(destPath);

	return FileUtils.ensureDir(destPathDir)
		.mapErr((err) => new FileSystemError("Failed to create dest dir", err))
		.andThen(() => checkCacheStatus(url, backupPath, abortSignal, config))
		.andThen((cacheStatus) => {
			if (!cacheStatus.shouldDownload && cacheStatus.existingFile) {
				return FileUtils.copy(cacheStatus.existingFile, destPath)
					.mapErr((e) => new FileSystemError("Failed to copy existing file to dest dir", e))
					.map(() => ({
						cacheHit: true,
						destPath,
					}));
			}

			return downloadFile(url, destPath, abortSignal, config).map(() => ({
				cacheHit: false,
				destPath,
			}));
		});
}

export async function findMediaUrls(
	dataStore: DataStore,
	options: MediaDownloaderConfigWithDefaults,
	queryJsonPath: string,
) {
	const returnUrls: { url: string; sourceId: string }[] = [];
	const filteredResult = dataStore.filter(options.keys);

	if (filteredResult.isErr()) {
		throw filteredResult.error;
	}

	for (const source of filteredResult.value) {
		const uniqueUrlSet = new Set();

		for (const document of source.documents) {
			const foundUrls = await document.query(queryJsonPath);

			for (const url of foundUrls) {
				uniqueUrlSet.add(url);
			}
		}

		for (const url of uniqueUrlSet) {
			returnUrls.push({ url: url as string, sourceId: source.namespaceId });
		}
	}

	return returnUrls;
}

function setupDownloadDirectories(
	ctx: ContentHookContext,
	config: MediaDownloaderConfigWithDefaults,
): ResultAsync<void, FileSystemError> {
	return (
		config.forceClearTempFiles
			? FileUtils.remove(ctx.paths.getTempPath()).andThen(() =>
					FileUtils.ensureDir(ctx.paths.getTempPath()),
				)
			: FileUtils.ensureDir(ctx.paths.getTempPath())
	).mapErr((err) => new FileSystemError("Failed to setup download directories", err));
}

function cleanupAfterDownload(
	ctx: ContentHookContext,
	config: MediaDownloaderConfigWithDefaults,
): ResultAsync<void, FileSystemError> {
	return FileUtils.copy(ctx.paths.getTempPath(), ctx.paths.getDownloadPath())
		.andThen(() => FileUtils.remove(ctx.paths.getTempPath()))
		.mapErr((err) => new FileSystemError("Failed to cleanup after download", err));
}

export default function mediaDownloader(config: z.input<typeof mediaDownloaderConfigSchema> = {}) {
	const configWithDefaults = parsePluginConfig(
		"mediaDownloader",
		mediaDownloaderConfigSchema,
		config,
	);

	return defineContentPlugin({
		name: "media-downloader",
		hooks: {
			onContentFetchDone(ctx) {
				if (
					!configWithDefaults.ignoreCache &&
					!configWithDefaults.enableIfModifiedSinceCheck &&
					!configWithDefaults.enableContentLengthCheck
				) {
					ctx.logger.warn(
						chalk.yellow(
							"Both enableIfModifiedSinceCheck and enableContentLengthCheck are disabled. The cache will be ignored.",
						),
					);
				}

				setMaxListeners(0, ctx.abortSignal);

				const queryJsonPath =
					configWithDefaults.matchPath ?? `$..[?(@.match(${configWithDefaults.mediaPattern}))]`;

				return setupDownloadDirectories(ctx, configWithDefaults)
					.andThen(() =>
						ResultAsync.fromPromise(
							findMediaUrls(ctx.data, configWithDefaults, queryJsonPath),
							(err) => new MediaDownloaderError("Failed to find media urls", err),
						),
					)
					.andThen((urls) => {
						const queue = new ResultAsyncQueue({
							concurrency: configWithDefaults.maxConcurrent,
						});

						const encodeRegex = new RegExp(`[${ctx.contentOptions.encodeChars}]`, "g");

						ctx.logger.info(`Syncing ${chalk.cyan(urls.length)} files`);

						const progressLogger = new MediaDownloaderProgressLogger(ctx.logger, urls.length);

						const tasks = urls.map((url) => {
							const task = ({ signal }: { signal?: AbortSignal }) =>
								downloadMedia(
									url.url,
									ctx.paths.getTempPath(url.sourceId),
									ctx.paths.getBackupPath(url.sourceId),
									encodeRegex,
									signal ?? ctx.abortSignal,
									configWithDefaults,
								).andTee(({ cacheHit }) => {
									if (cacheHit) {
										progressLogger.addCached();
									} else {
										progressLogger.addFetched();
									}
								});
							return task;
						});

						return queue
							.addAll(tasks, {
								abortOnError: configWithDefaults.abortOnError,
								logger: ctx.logger,
							})
							.andTee(() => {
								progressLogger.close();

								ctx.logger.info(
									`Finished downloading ${chalk.cyan(tasks.length)} files to ${chalk.cyan(
										ctx.paths.getDownloadPath(),
									)}`,
								);

								ctx.logger.info(
									`Of the ${chalk.cyan(tasks.length)} media files, ${chalk.green(
										progressLogger.fetched,
									)} were downloaded and ${chalk.yellow(progressLogger.cached)} were pulled from cache`,
								);
							})
							.orElse((queueErrors) => {
								progressLogger.close();

								ctx.logger.error(
									`Encountered ${chalk.red(`${queueErrors.length} error(s)`)} while downloading ${chalk.cyan(tasks.length)} files`,
								);

								for (const error of queueErrors) {
									ctx.logger.error(chalk.red(error));
								}

								if (configWithDefaults.abortOnError) {
									return FileUtils.remove(ctx.paths.getTempPath())
										.mapErr((err) => new FileSystemError("Failed to remove temp dir", err))
										.andThen(() => errAsync(new QueueError(queueErrors)));
								}

								return ok(undefined);
							});
					})
					.andThen(() => {
						ctx.logger.debug('Moving downloaded media files to "download" directory');
						return cleanupAfterDownload(ctx, configWithDefaults);
					})
					.orElse((e) => {
						throw e;
					})
					.then(() => {
						// return void
					});
			},
		},
	});
}

/**
 * Base error class for MediaDownloader errors
 */
class MediaDownloaderError extends Error {
	constructor(message: string, cause?: unknown) {
		if (cause === undefined) {
			super(message);
		} else if (cause instanceof Error) {
			super(`${message}: ${cause.message}`, { cause });
		} else {
			super(`${message}: ${cause}`);
		}
		this.name = "MediaDownloaderError";
	}
}

class FileSystemError extends MediaDownloaderError {
	constructor(message: string, cause?: unknown) {
		super(message, cause);
		this.name = "FileSystemError";
	}
}

class NetworkError extends MediaDownloaderError {
	constructor(message: string, cause?: unknown) {
		super(message, cause);
		this.name = "NetworkError";
	}
}

class CacheError extends MediaDownloaderError {
	constructor(message: string, cause?: unknown) {
		super(message, cause);
		this.name = "CacheError";
	}
}

class QueueError extends MediaDownloaderError {
	errors: Error[];

	/**
	 * @param {Error[]} errors
	 */
	constructor(errors: Error[]) {
		super(`Queue encountered ${errors.length} errors`);
		this.name = "QueueError";
		this.errors = errors;
	}
}

class MediaDownloaderProgressLogger extends FixedConsoleLogger {
	#total: number;
	#fetched = 0;
	#cached = 0;

	get fetched() {
		return this.#fetched;
	}

	get cached() {
		return this.#cached;
	}

	constructor(logger: Logger, total: number) {
		super(logger, 0);
		this.#total = total;
	}

	addFetched() {
		this.#fetched++;
		this.update();
	}

	addCached() {
		this.#cached++;
		this.update();
	}

	#renderProgressBar() {
		const total = this.#total;
		const fetched = this.#fetched;
		const cached = this.#cached;
		const BAR_LENGTH = 60;

		// Calculate exact segments
		const fetchedLength = Math.round((fetched / total) * BAR_LENGTH);
		const cachedLength = Math.round((cached / total) * BAR_LENGTH);
		// Ensure remaining is never negative
		const remainingLength = Math.max(0, BAR_LENGTH - fetchedLength - cachedLength);

		const fetchedBar = chalk.green("=".repeat(fetchedLength));
		const cachedBar = chalk.yellow("=".repeat(cachedLength));
		const remainingBar = chalk.gray("=".repeat(remainingLength));

		return `${fetchedBar}${cachedBar}${remainingBar}`;
	}

	override getFixedConsoleMessage(): string {
		return (
			`Syncing Media: ${this.#renderProgressBar()}\n` +
			`Fetched: ${chalk.green(this.#fetched)}, Cached: ${chalk.yellow(this.#cached)}, Remaining: ${this.#total - this.#fetched - this.#cached} \n`
		);
	}
}
