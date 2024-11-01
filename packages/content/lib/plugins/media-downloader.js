import fs from 'fs';
import { defineContentPlugin, defineContentPluginHooks } from '../content-plugin-driver.js';
import { setMaxListeners } from 'events';
import path from 'path';
import { JSONPath } from 'jsonpath-plus';
import chalk from 'chalk';
import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow';
import { safeKy } from '../utils/safe-ky.js';
import { pipeline } from 'node:stream/promises';
import ResultAsyncQueue from '../utils/result-async-queue.js';
import * as FileUtils from '../utils/file-utils.js';

const DEFAULT_MEDIA_PATTERN = /\.(jpg|jpeg|png|webp|avi|mov|mp4|mpg|mpeg|webm)$/i;

/** 
 * @typedef MediaDownloaderConfig
 * @property {import('../utils/data-store.js').DataKeys} [keys] Data keys to search for media urls. If not provided, all keys will be searched.
 * @property {RegExp} [mediaPattern] Regex to match urls to download.
 * @property {string} [matchPath] JSONPath-Plus compatible paths to match urls to download. Overrides `mediaPattern`.
 * @property {number} [maxConcurrent] Number of concurrent downloads
 * @property {boolean} [clearOldFilesOnSuccess] Remove all pre-existing files in dest dir when downloads succeed. Ignores files that match `keep`. Defaults to true.
 * @property {boolean} [ignoreCache] Will always download files regardless of whether they've been cached. Defaults to false.
 * @property {boolean} [enableIfModifiedSinceCheck] Enables the HTTP if-modified-since check. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true.
 * @property {boolean} [enableContentLengthCheck] Compares the HTTP header content-length with the local file size. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true.
 * @property {boolean} [forceClearTempFiles] Clear the temp dir before starting downloads. This means the cache will be ignored. Defaults to false.
 * @property {(path: string) => string} [transformLocalPath] Function to transform the local path of the downloaded file.
 * @property {number} [maxTimeout] Maximum timeout for the HTTP request. Defaults to 10 seconds.
 * @property {boolean} [abortOnError] If true, the queue will stop and throw an error if any of the media requests fail. If false, the queue will continue to download the remaining files and log all errors, but not throw. Defaults to true.
 */

/** 
 * @typedef DownloadTask
 * @property {string} url
 * @property {string} destDir
 * @property {string} tempDir
 */

/**
 * @param {string} url
 * @returns {string}
 */
export function localFilePathFromUrl(url) {
	let urlPath = url.replace(/^[^:]+:\/\/[^/]+/, '');
	if (urlPath.startsWith('/')) {
		urlPath = urlPath.slice(1);
	}
	return urlPath.replace(/\//g, path.sep);
}

/**
 * @param {string} url
 * @param {string} destPath
 * @param {AbortSignal} abortSignal
 * @param {Pick<MediaDownloaderConfigWithDefaults, 'ignoreCache' | 'enableIfModifiedSinceCheck' | 'enableContentLengthCheck' | 'maxTimeout'>} config
 * @returns {ResultAsync<{ shouldDownload: boolean, existingFile?: string, stats?: fs.Stats }, FileSystemError | NetworkError | CacheError>}
 */
export function checkCacheStatus(url, destPath, abortSignal, config) {
	return FileUtils.pathExists(destPath)
		.mapErr(err => new FileSystemError('Failed to check if file exists', err))
		.andThen(exists => exists
			? ResultAsync.fromPromise(
				fs.promises.lstat(destPath),
				err => new FileSystemError(`Failed to get file stats for ${destPath}`, err)
			)
			: okAsync(null)
		)
		.map(stats => {
			if (config.ignoreCache || !stats || !stats.isFile()) {
				return { shouldDownload: true };
			}

			if (!config.enableIfModifiedSinceCheck && !config.enableContentLengthCheck) {
				return { shouldDownload: true };
			}

			return { shouldDownload: false, existingFile: destPath, stats };
		})
		.andThen(result => {
			if (result.shouldDownload || !result.stats) {
				return okAsync(result);
			}

			return safeKy(url, {
				method: 'HEAD',
				signal: abortSignal,
				timeout: config.maxTimeout,
				throwHttpErrors: false,
				headers: {
					'If-Modified-Since': result.stats.mtime.toUTCString()
				}
			})
				.mapErr(err => new NetworkError(`Failed to check cache status for ${url}`, err))
				.map(res => {
					let isRemoteNew = false;

					if (config.enableIfModifiedSinceCheck) {
						isRemoteNew = res.status !== 304;
					}

					if (config.enableContentLengthCheck) {
						const remoteSize = parseInt(res.headers.get('content-length') ?? '');
						const localSize = result.stats.size;
						isRemoteNew = isRemoteNew || (remoteSize !== localSize);
					}

					return {
						shouldDownload: isRemoteNew,
						existingFile: result.existingFile,
						stats: result.stats
					};
				});
		});
}

/**
 * @param {string} url
 * @param {string} filePath
 * @param {AbortSignal} abortSignal
 * @param {MediaDownloaderConfigWithDefaults} config
 * @returns {ResultAsync<void, FileSystemError | NetworkError>}
 */
export function downloadFile(url, filePath, abortSignal, config) {
	return safeKy(url, {
		signal: abortSignal,
		timeout: config.maxTimeout
	})
		.mapErr(err => new NetworkError(`Failed to download ${url}`, err))
		.andThen(res => {
			if (!res.body) {
				return errAsync(new Error('No response body'));
			}

			const writer = fs.createWriteStream(filePath);
			return ResultAsync.fromPromise(
				pipeline(res.body, writer),
				err => new FileSystemError(`Failed to write file: ${err}`, err)
			);
		});
}

/**
 * @param {string} url
 * @param {string} tempDir
 * @param {string} destDir
 * @param {RegExp} encodeRegex
 * @param {AbortSignal} abortSignal
 * @param {MediaDownloaderConfigWithDefaults} config
 * @returns {ResultAsync<string, FileSystemError | NetworkError | CacheError>}
 */
export function downloadMedia(url, tempDir, destDir, encodeRegex, abortSignal, config) {
	const localPath = config.transformLocalPath(localFilePathFromUrl(url))
		.replace(encodeRegex, encodeURIComponent);

	const destPath = path.join(destDir, localPath);
	const tempFilePath = path.join(tempDir, localPath);
	const tempFilePathDir = path.dirname(tempFilePath);

	return FileUtils.ensureDir(tempFilePathDir)
		.mapErr(err => new FileSystemError('Failed to create temp dir', err))
		.andThen(() => checkCacheStatus(url, destPath, abortSignal, config))
		.andThen(cacheStatus => {
			if (!cacheStatus.shouldDownload && cacheStatus.existingFile) {
				return FileUtils.copy(cacheStatus.existingFile, tempFilePath)
					.mapErr(e => new FileSystemError('Failed to copy existing file to temp dir', e));
			}
			return downloadFile(url, tempFilePath, abortSignal, config);
		})
		.map(() => tempFilePath);
}

/**
 * @param {import('../utils/data-store.js').DataStore} dataStore
 * @param {MediaDownloaderConfigWithDefaults} options
 * @param {string} queryJsonPath
 * @returns {Array<{ url: string, sourceId: string }>}
 */
export function findMediaUrls(dataStore, options, queryJsonPath) {
	/** @type {Array<{ url: string, sourceId: string }>} */
	const returnUrls = [];
	const filteredResult = dataStore.filter(options.keys);

	if (filteredResult.isErr()) {
		throw filteredResult.error;
	}

	for (const source of filteredResult.value) {
		const uniqueUrlSet = new Set();
		
		for (const document of source.documents) {
			const foundUrls = /** @type {Array<string>} */ (JSONPath({
				json: document.data,
				path: queryJsonPath,
				ignoreEvalErrors: true
			}));

			foundUrls.forEach(url => uniqueUrlSet.add(url));
		}

		uniqueUrlSet.forEach(url => returnUrls.push({ url, sourceId: source.namespaceId }));
	}

	return returnUrls;
}

/**
 * @param {import('../content-plugin-driver.js').ContentHookContext} ctx
 * @param {MediaDownloaderConfigWithDefaults} config
 * @returns {ResultAsync<void, FileSystemError>}
 */
export function setupDownloadDirectories(ctx, config) {
	return (config.forceClearTempFiles
		? FileUtils.remove(ctx.paths.getTempPath())
			.andThen(() => FileUtils.ensureDir(ctx.paths.getTempPath()))
		: FileUtils.ensureDir(ctx.paths.getTempPath()))
		.mapErr(err => new FileSystemError('Failed to setup download directories', err));
}

/**
 * @param {import('../content-plugin-driver.js').ContentHookContext} ctx
 * @param {MediaDownloaderConfigWithDefaults} config
 * @returns {ResultAsync<void, FileSystemError>}
 */
export function cleanupAfterDownload(ctx, config) {
	return (config.clearOldFilesOnSuccess
		? FileUtils.removeFilesFromDir(ctx.paths.getDownloadPath(), ctx.contentOptions.keep)
		: okAsync(undefined))
		.andThen(() => FileUtils.copy(ctx.paths.getTempPath(), ctx.paths.getDownloadPath()))
		.andThen(() => FileUtils.remove(ctx.paths.getTempPath()))
		.mapErr(err => new FileSystemError('Failed to cleanup after download', err));
}

/**
 * @satisfies {MediaDownloaderConfig}
 */
const DEFAULT_MEDIA_DOWNLOADER_CONFIG = {
	mediaPattern: DEFAULT_MEDIA_PATTERN,
	maxConcurrent: 4,
	clearOldFilesOnSuccess: true,
	ignoreCache: false,
	enableIfModifiedSinceCheck: true,
	enableContentLengthCheck: true,
	forceClearTempFiles: false,
	transformLocalPath: (path) => path,
	maxTimeout: 10000,
	abortOnError: true
};

/**
 * @param {MediaDownloaderConfig} config
 */
export function getMediaDownloaderConfig(config) {
	return { ...DEFAULT_MEDIA_DOWNLOADER_CONFIG, ...config };
}

/** @typedef {ReturnType<typeof getMediaDownloaderConfig>} MediaDownloaderConfigWithDefaults */

/**
 * @param {MediaDownloaderConfig} config
 */
export default function mediaDownloader(config = {}) {
	const configWithDefaults = getMediaDownloaderConfig(config);

	return defineContentPlugin({
		name: 'media-downloader',
		hooks: defineContentPluginHooks({
			onContentFetchDone(ctx) {
				if (!configWithDefaults.ignoreCache &&
						!configWithDefaults.enableIfModifiedSinceCheck &&
						!configWithDefaults.enableContentLengthCheck) {
					ctx.logger.warn(chalk.yellow(
						'Both enableIfModifiedSinceCheck and enableContentLengthCheck are disabled. The cache will be ignored.'
					));
				}

				setMaxListeners(0, ctx.abortSignal);

				const queryJsonPath = configWithDefaults.matchPath ??
					`$..[?(@.match(${configWithDefaults.mediaPattern}))]`;

				return setupDownloadDirectories(ctx, configWithDefaults)
					.map(() => findMediaUrls(ctx.data, configWithDefaults, queryJsonPath))
					.andThen(urls => {
						const queue = new ResultAsyncQueue({
							concurrency: configWithDefaults.maxConcurrent
						});

						const encodeRegex = new RegExp(`[${ctx.contentOptions.encodeChars}]`, 'g');

						const tasks = urls.map(url => {
							/**
							 * @param {{ signal?: AbortSignal }} args
							 */
							const task = ({ signal }) => downloadMedia(
								url.url,
								path.join(ctx.paths.getTempPath(), url.sourceId),
								path.join(ctx.paths.getDownloadPath(), url.sourceId),
								encodeRegex,
								signal ?? ctx.abortSignal,
								configWithDefaults
							);
							return task;
						});

						ctx.logger.info(`Syncing ${chalk.cyan(tasks.length)} files`);

						return queue.addAll(tasks, {
							abortOnError: configWithDefaults.abortOnError,
							logger: ctx.logger
						}).orElse((queueErrors) => {
							ctx.logger.error(
								`Encountered ${chalk.red(queueErrors.length + ' error(s)')} while downloading ${chalk.cyan(tasks.length)} files`
							);
	
							for (const error of queueErrors) {
								ctx.logger.error(chalk.red(error));
							}
	
							if (configWithDefaults.abortOnError) {
								return FileUtils.remove(ctx.paths.getTempPath())
									.mapErr(err => new FileSystemError('Failed to remove temp dir', err))
									.andThen(() => errAsync(new QueueError(queueErrors)));
							}

							return ok(undefined);
						});
					})
					.andThen(() => {
						return cleanupAfterDownload(ctx, configWithDefaults);
					})
					.orElse(e => {
						throw e;
					}).then(() => {
						// return void
					});
			}
		})
	});
}

/**
 * Base error class for MediaDownloader errors
 */
class MediaDownloaderError extends Error {
	/**
	 * @param {string} message 
	 * @param {unknown} [cause] 
	 */
	constructor(message, cause) {
		if (cause === undefined) {
			super(message);
		} else if (cause instanceof Error) {
			super(`${message}: ${cause.message}`, { cause });
		} else {
			super(`${message}: ${cause}`);
		}
		this.name = 'MediaDownloaderError';
	}
}

class FileSystemError extends MediaDownloaderError {
	/**
	 * @param {string} message 
	 * @param {unknown} [cause] 
	 */
	constructor(message, cause) {
		super(message, cause);
		this.name = 'FileSystemError';
	}
}

class NetworkError extends MediaDownloaderError {
	/**
	 * @param {string} message 
	 * @param {unknown} [cause] 
	 */
	constructor(message, cause) {
		super(message, cause);
		this.name = 'NetworkError';
	}
}

class CacheError extends MediaDownloaderError {
	/**
	 * @param {string} message 
	 * @param {unknown} [cause] 
	 */
	constructor(message, cause) {
		super(message, cause);
		this.name = 'CacheError';
	}
}

class QueueError extends MediaDownloaderError {
	/** @type {Error[]} */
	errors;

	/**
	 * @param {Error[]} errors
	 */
	constructor(errors) {
		super(`Queue encountered ${errors.length} errors`);
		this.name = 'QueueError';
		this.errors = errors;
	}
}
