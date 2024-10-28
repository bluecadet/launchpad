import fs from 'fs';
import { defineContentPlugin, defineContentPluginHooks } from '../content-plugin-driver.js';
import { setMaxListeners } from 'events';
import path from 'path';
import { JSONPath } from 'jsonpath-plus';
import chalk from 'chalk';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { safeKy } from '../utils/safe-ky.js';
import { pipeline } from 'node:stream/promises';
import ResultAsyncQueue from '../utils/result-async-queue.js';
import * as FileUtils from '../utils/file-utils.js';

const DEFAULT_MEDIA_PATTERN = /https?:\/\/[^ ]+\.(jpg|jpeg|png|webp|avi|mov|mp4|mpg|mpeg|webm)$/i;

/** 
 * @typedef MediaDownloaderOptions
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
 * @satisfies {MediaDownloaderOptions}
 */
const DEFAULT_MEDIA_DOWNLOADER_OPTIONS = {
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
 * @param {MediaDownloaderOptions} options
 */
function getMediaDownloaderOptions(options) {
	return { ...DEFAULT_MEDIA_DOWNLOADER_OPTIONS, ...options };
}

/**
 * @typedef {ReturnType<typeof getMediaDownloaderOptions>} MediaDownloaderOptionsWithDefaults
 */

/**
 * @param {MediaDownloaderOptions} options
 */
export default function mediaDownloader(options = {}) {
	const optionsWithDefaults = getMediaDownloaderOptions(options);

	return defineContentPlugin({
		name: 'media-downloader',
		hooks: defineContentPluginHooks({
			async onContentFetchDone(ctx) {
				if (!optionsWithDefaults.ignoreCache && !optionsWithDefaults.enableIfModifiedSinceCheck && !optionsWithDefaults.enableContentLengthCheck) {
					ctx.logger.warn(chalk.yellow('Both enableIfModifiedSinceCheck and enableContentLengthCheck are disabled. The cache will be ignored.'));
				}

				const filteredData = ctx.data.filter(optionsWithDefaults.keys);

				if (filteredData.isErr()) {
					throw new Error(filteredData.error);
				}

				const queryJsonPath = optionsWithDefaults.matchPath ?? `$..*[?(@.match(${optionsWithDefaults.mediaPattern.source}))]`;

				const queue = new ResultAsyncQueue({ concurrency: optionsWithDefaults.maxConcurrent });

				// Note, this should be 1 per concurrent request, plus 1 for the PQueue, 
				// but there's a bug in node where it doesn't cleanup the fetch listeners.
				// for now we'll just set it to no limit
				setMaxListeners(0, ctx.abortSignal);

				const keepFilter = ctx.contentOptions.keep;

				if (optionsWithDefaults.forceClearTempFiles && fs.existsSync(ctx.paths.getTempPath())) {
					ctx.logger.debug(chalk.gray(`Clearing temp dir: ${chalk.yellow(ctx.paths.getTempPath())}`));
					const removeResult = await FileUtils.remove(ctx.paths.getTempPath());

					if (removeResult.isErr()) {
						throw removeResult.error;
					}
				}

				ctx.logger.debug(chalk.gray(`Creating temp dir: ${chalk.yellow(ctx.paths.getTempPath())}`));
				const ensureDirResult = await FileUtils.ensureDir(ctx.paths.getTempPath());

				if (ensureDirResult.isErr()) {
					throw ensureDirResult.error;
				}

				/** @type {Array<(options: { signal?: AbortSignal }) => ReturnType<typeof downloadMedia>>} */
				const tasks = [];

				const encodeRegex = new RegExp(`[${ctx.contentOptions.encodeChars}]`, 'g');

				for (const source of filteredData.value) {
					/** @type {Set<string>} */
					const uniqueUrlSet = new Set();

					const sourceTempDir = path.join(ctx.paths.getTempPath(), source.namespaceId);
					const sourceDestDir = path.join(ctx.paths.getDownloadPath(), source.namespaceId);

					for (const document of source.documents) {
						// search each document for matching urls
						const urls = JSONPath({
							json: document.data,
							path: queryJsonPath
						});

						for (const url of urls) {
							// skip duplicates
							if (uniqueUrlSet.has(url)) {
								continue;
							}

							uniqueUrlSet.add(url);

							tasks.push(
								({ signal }) => downloadMedia(
									url,
									sourceTempDir,
									sourceDestDir,
									encodeRegex,
									signal ?? ctx.abortSignal,
									optionsWithDefaults
								)
							);
						}
					}
				}

				ctx.logger.info(`Syncing ${chalk.cyan(tasks.length)} files`);

				const result = await queue.addAll(tasks, { abortOnError: optionsWithDefaults.abortOnError, logger: ctx.logger });

				if (result.isErr()) {
					ctx.logger.error(`Encountered ${chalk.red(result.error.length + ' error(s)')} while downloading ${chalk.cyan(tasks.length)} files`);

					for (const error of result.error) {
						ctx.logger.error(chalk.red(error));
					}

					if (optionsWithDefaults.abortOnError) {
						// clear temp dir
						ctx.logger.warn(`Removing temp dir at ${chalk.yellow(ctx.paths.getTempPath())} due to sync error`);
						await FileUtils.remove(ctx.paths.getTempPath());

						throw result.error;
					}
				}

				if (optionsWithDefaults.clearOldFilesOnSuccess) {
					ctx.logger.debug(chalk.gray(`Removing old files from: ${chalk.yellow(ctx.paths.getDownloadPath())}`));
					const removeResult = await FileUtils.removeFilesFromDir(ctx.paths.getDownloadPath(), keepFilter);

					if (removeResult.isErr()) {
						throw removeResult.error;
					}
				}

				ctx.logger.debug(chalk.gray(`Copying new files to: ${chalk.green(ctx.paths.getDownloadPath())}`));
				const copyResult = await FileUtils.copy(ctx.paths.getTempPath(), ctx.paths.getDownloadPath());

				if (copyResult.isErr()) {
					throw copyResult.error;
				}

				ctx.logger.debug(chalk.gray(`Removing temp dir: ${chalk.yellow(ctx.paths.getTempPath())}`));
				const removeResult = await FileUtils.remove(ctx.paths.getTempPath());

				if (removeResult.isErr()) {
					throw removeResult.error;
				}
			}
		})
	});
}

/**
 * @param {string} url URL to download
 * @param {string} tempDir Directory path for temporary files. Where downloaded files are stored before being moved to `destDir`.
 * @param {string} destDir Directory path for final downloaded files. Contains cached files.
 * @param {RegExp} encodeRegex Regex to encode the local path of the downloaded file.
 * @param {AbortSignal} abortSignal Abort signal to cancel the request
 * @param {MediaDownloaderOptionsWithDefaults} options
 */
function downloadMedia(url, tempDir, destDir, encodeRegex, abortSignal, options) {
	const localPath = options.transformLocalPath(localFilePathFromUrl(url)).replace(encodeRegex, encodeURIComponent); ;

	const destPath = path.join(destDir, localPath);
	const tempFilePath = path.join(tempDir, localPath);
	const tempFilePathDir = path.dirname(tempFilePath);

	return FileUtils.ensureDir(tempFilePathDir)
		.andThen(() => FileUtils.pathExists(destPath))
		.andThen((exists) => exists
			? ResultAsync.fromPromise(fs.promises.lstat(destPath), (err) => new Error(`Error getting file stats for ${destPath}: ${err}`))
			: okAsync(null)
		).andThen(stats => {
			if (options.ignoreCache || !stats || !stats.isFile()) {
				// skip cache check
				return okAsync(false);
			}

			if (!options.enableIfModifiedSinceCheck && !options.enableContentLengthCheck) {
				// skip cache check
				return okAsync(false);
			}

			const modifiedDate = stats.mtime;

			return safeKy(url, {
				method: 'HEAD',
				signal: abortSignal,
				timeout: options.maxTimeout,
				throwHttpErrors: false,
				headers: {
					'If-Modified-Since': modifiedDate.toUTCString()
				}
			}).andThen(res => {
				let isRemoteNew = false;

				if (options.enableIfModifiedSinceCheck) {
					isRemoteNew = res.status !== 304;
				}

				if (options.enableContentLengthCheck) {
					const remoteSize = parseInt(res.headers.get('content-length') ?? '');
					const localSize = stats.size;
					isRemoteNew = isRemoteNew || (remoteSize !== localSize);
				}

				if (!isRemoteNew) {
					// copy existing, cached file from dest dir
					return ResultAsync.fromPromise(fs.promises.copyFile(destPath, tempFilePath), (err) => new Error(`Error copying file from ${destPath} to ${tempFilePath}: ${err}`))
						.map(() => true);
				}

				return okAsync(false);
			}).andThen(cached => {
				if (cached) {
					return okAsync(undefined);
				}

				return safeKy(url, {
					signal: abortSignal,
					timeout: options.maxTimeout
				}).andThen(res => {
					if (!res.body) {
						return errAsync(new Error('No response body'));
					}

					const writer = fs.createWriteStream(tempFilePath);

					return ResultAsync.fromPromise(pipeline(res.body, writer), (err) => new Error(`Error writing file to ${tempFilePath}: ${err}`));
				});
			});
		}).map(() => tempFilePath); // always return the path to the temp file
}

/**
 * Given a full URL, build a unique path to save the file
 * @param {string} url
 * @returns {string}
 */
function localFilePathFromUrl(url) {
	// Remove protocol and domain
	let urlPath = url.replace(/^[^:]+:\/\/[^/]+/, '');
	
	// Remove leading slash if present
	if (urlPath.startsWith('/')) {
		urlPath = urlPath.slice(1);
	}

	// Use the OS path separator
	const localPath = urlPath.replace(/\//g, path.sep);
	
	return localPath;
}
