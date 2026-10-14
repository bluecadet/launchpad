import { setMaxListeners } from "node:events";
import path from "node:path";
import chalk from "chalk";
import { type Result, ResultAsync } from "neverthrow";
import { z } from "zod";
import { downloadHttpArtifact } from "../cache/http-cache.js";
import { ContentProgressLogger } from "../content-progress-logger.js";
import { defineContentTransform } from "../content-transform.js";
import type { DataStore } from "../utils/data-store.js";
import * as FileUtils from "../utils/file-utils.js";
import ResultAsyncQueue from "../utils/result-async-queue.js";
import { parseTransformConfig, queryOrUpdate } from "./content-transform-helpers.js";

const DEFAULT_MEDIA_PATTERN = /https?.*\.(jpe?g|png|webp|avi|mov|mp4|mpg|mpeg|webm)(\?.*)?$/i;

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
		.union(
			[z.string(), z.array(z.string())], // Allow single string or array of strings
		)
		.optional()
		.describe(
			"JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`.",
		),
	/** Number of concurrent downloads */
	maxConcurrent: z.int().positive().describe("Number of concurrent downloads").default(4),
	/** Will always download files regardless of whether they've been cached. Defaults to false. */
	ignoreCache: z
		.boolean()
		.describe("Will always download files regardless of whether they've been cached.")
		.default(false),
	/** Clear transform staging temp files before starting downloads. Does not invalidate the HTTP cache. Defaults to false. */
	forceClearTempFiles: z
		.boolean()
		.describe(
			"Clear transform staging temp files before starting downloads. Does not invalidate the HTTP cache.",
		)
		.default(false),
	/** Function to transform the local path of the downloaded file. */
	transformLocalPath: z
		.function({
			input: [z.string()],
			output: z.string(),
		})
		.describe("Function to transform the local path of the downloaded file.")
		.optional(),
	/** Maximum timeout for the HTTP request. Defaults to 10 seconds. */
	maxTimeout: z.int().positive().describe("Maximum timeout for the HTTP request.").default(10000),
	/** If true, the queue will stop and throw an error if any of the media requests fail. If false, the queue will continue to download the remaining files and log all errors, but not throw. Defaults to true. */
	abortOnError: z
		.boolean()
		.describe(
			"If true, the queue will stop and throw an error if any of the media requests fail. If false, the queue will continue to download the remaining files and log all errors, but not throw.",
		)
		.default(true),
	/**
	 * Update downloaded media URLs in content to point to the new location, relative to the source download directory.
	 * Defaults to true.
	 */
	updatePaths: z
		.boolean()
		.default(true)
		.describe(
			"Update downloaded media URLs in content to point to the new location, relative to the source download directory. This option is required if you want to use the 'sharp' plugin to transform downloaded images.",
		),
});

type MediaDownloaderConfigWithDefaults = z.infer<typeof mediaDownloaderConfigSchema>;

export function localFilePathFromUrl(url: string) {
	let urlPath = url.replace(/^[^:]+:\/\/[^/]+/, "");
	if (urlPath.startsWith("/")) {
		urlPath = urlPath.slice(1);
	}
	return urlPath.replace(/\//g, path.sep);
}

type MediaDownload = {
	url: string;
	sourceId: string;
	localPath: string;
};

export async function findMediaUrls(
	dataStore: DataStore,
	options: MediaDownloaderConfigWithDefaults,
	encodeChars: string,
	queryJsonPaths: string[],
) {
	const returnUrls: MediaDownload[] = [];
	const filteredResult = dataStore.filter(options.keys);

	if (filteredResult.isErr()) {
		throw filteredResult.error;
	}

	const encodeRegex = new RegExp(`[${encodeChars}]`, "g");
	const transformFn = options.transformLocalPath ?? ((path) => path);

	for (const source of filteredResult.value) {
		const uniqueUrlSet = new Set();

		for (const queryJsonPath of queryJsonPaths) {
			const queryResult = await queryOrUpdate({
				documents: source.documents,
				queryJsonPath,
				update: options.updatePaths,
				callback: async (val: unknown) => {
					if (typeof val !== "string") {
						throw new Error(`Expected value to be a string, but got '${typeof val}'.`);
					}

					const localPath = transformFn(localFilePathFromUrl(val)).replace(
						encodeRegex,
						encodeURIComponent,
					);

					if (!uniqueUrlSet.has(val)) {
						uniqueUrlSet.add(val);
						returnUrls.push({ url: val, sourceId: source.namespaceId, localPath });
					}

					return localPath;
				},
			});
			if (queryResult.isErr()) throw queryResult.error;
		}
	}

	return returnUrls;
}

export default function mediaDownloader(config: z.input<typeof mediaDownloaderConfigSchema> = {}) {
	for (const removedOption of ["enableIfModifiedSinceCheck", "enableContentLengthCheck"]) {
		if (Object.hasOwn(config, removedOption)) {
			throw new MediaDownloaderError(
				`${removedOption} has been removed. mediaDownloader now follows server HTTP cache policy; use ignoreCache: true to force full downloads.`,
			);
		}
	}
	const configWithDefaults = parseTransformConfig(
		"mediaDownloader",
		mediaDownloaderConfigSchema,
		config,
	);

	return defineContentTransform({
		name: "media-downloader",
		async apply(ctx) {
			setMaxListeners(0, ctx.abortSignal);
			if (configWithDefaults.forceClearTempFiles) {
				await FileUtils.remove(ctx.paths.getTempPath()).match(
					() => {},
					(error) => {
						throw new FileSystemError("Failed to clear transform temp files", error);
					},
				);
			}

			const queryJsonPath =
				configWithDefaults.matchPath ?? `$..[?(@.match(${configWithDefaults.mediaPattern}))]`;
			const queryJsonPaths = Array.isArray(queryJsonPath) ? queryJsonPath : [queryJsonPath];
			const mediaItems = await findMediaUrls(
				ctx.data,
				configWithDefaults,
				ctx.contentOptions.encodeChars,
				queryJsonPaths,
			).catch((error: unknown) => {
				throw new MediaDownloaderError("Failed to find media urls", error);
			});
			const queue = new ResultAsyncQueue({ concurrency: configWithDefaults.maxConcurrent });
			ctx.logger.info(`Syncing ${chalk.cyan(mediaItems.length)} files`);
			const progressLogger = new ContentProgressLogger({
				eventBus: ctx.eventBus,
				total: mediaItems.length,
				label: "Syncing Media",
				freshLabel: "Fetched",
			});
			const tasks = mediaItems.map(
				(mediaItem) =>
					({ signal }: { signal?: AbortSignal }) =>
						ResultAsync.fromPromise(
							downloadHttpArtifact({
								cache: ctx.cache,
								sourceId: mediaItem.sourceId,
								outputPath: mediaItem.localPath,
								url: mediaItem.url,
								signal: signal ?? ctx.abortSignal,
								timeout: configWithDefaults.maxTimeout,
								ignoreCache: configWithDefaults.ignoreCache,
							}),
							(error) =>
								error instanceof Error
									? error
									: new MediaDownloaderError("Failed to download media", error),
						).andTee(({ cacheHit }) => {
							if (cacheHit) ctx.logger.debug("HTTP media cache hit");
							progressLogger.complete({ reused: cacheHit });
						}),
			);
			let result: Result<{ cacheHit: boolean }[], Error[]>;
			try {
				result = await queue.addAll(tasks, {
					abortOnError: configWithDefaults.abortOnError,
					logger: ctx.logger,
				});
			} finally {
				await queue.queue.onIdle();
				progressLogger.close();
			}
			if (result.isErr()) {
				ctx.logger.error(
					`Encountered ${chalk.red(`${result.error.length} error(s)`)} while downloading ${chalk.cyan(tasks.length)} files`,
				);
				for (const error of result.error) {
					ctx.logger.error(chalk.red(`Media request failed (${error.name})`));
				}
				if (configWithDefaults.abortOnError) throw new QueueError(result.error);
				return;
			}
			ctx.logger.info(
				`Finished downloading ${chalk.cyan(tasks.length)} files to ${chalk.cyan(ctx.paths.getDownloadPath())}`,
			);
			ctx.logger.info(
				`Of the ${chalk.cyan(tasks.length)} media files, ${chalk.green(progressLogger.fresh)} were downloaded and ${chalk.yellow(progressLogger.cached)} were pulled from cache`,
			);
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
