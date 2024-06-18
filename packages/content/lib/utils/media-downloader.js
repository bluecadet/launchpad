import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import stream from 'stream';

import chalk from 'chalk';
import got from 'got'; // http requests
import sharp from 'sharp'; // image manipulation
import cliProgress from 'cli-progress';

import FileUtils from './file-utils.js';
import { MediaDownload } from '../content-sources/content-result.js';

const pipeline = promisify(stream.pipeline);

/**
 * @type {typeof import('p-queue').default?}
 */
let PQueue = null; // Future import

/**
 * Downloads a batch of urls to a target directory.
 * Existing files will be compared for date and size.
 * If an error occurs, content is rolled back to its original state.
 */
export class MediaDownloader {
	/** @param {import('@bluecadet/launchpad-utils').Logger | Console} logger */
	constructor(logger) {
		this.logger = logger || console;
	}

	/**
	 * Downloads a set of URLs into a destination folder.
	 *
	 * All downloads will be performed in `options.tempPath`.
	 * If anything fails, the temporary files will be removed.
	 * If the whole batch succeeds, all files will be moved to
	 * the `options.dest` folder.
	 *
	 * If `options.clearOldFilesOnStart` or `options.clearOldFilesOnSuccess`
	 * are `true`, then the `options.downloadPath` directory will be cleared
	 * before/after all downloads start/complete. If anything fails during,
	 * the downloads, `options.dest` will remain untouched.
	 *
	 * @param {Array<MediaDownload>} downloads
	 * @param {import('../content-options.js').ResolvedContentOptions} options
	 */
	async sync(downloads, options) {
		this.logger.info(`Syncing ${chalk.cyan(downloads.length)} files`);

		if (!PQueue) {
			// @see https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c#pure-esm-package
			PQueue = (await import('p-queue')).default;
		}
		const queue = new PQueue({
			concurrency: options.maxConcurrent || 4
		});

		let tempDir = '';
		/**
		 * @type {cliProgress.Bar | null}
		 */
		let progress = null;

		try {
			const destDir = path.resolve(options.downloadPath);
			tempDir = path.resolve(options.tempPath);

			/* BB: Commented code below allows for tempDir to be part of
			 destDir but breaks if tempDir is not a child of destDir */
			// let keepFilter = path.relative(destDir, tempDir);
			// if (options.keep) {
			//   keepFilter += '|' + options.keep;
			// }
			const keepFilter = options.keep;

			if (options.clearOldFilesOnStart) {
				this.logger.debug(chalk.gray(`Removing old files from: ${chalk.yellow(destDir)}`));
				await FileUtils.removeFilesFromDir(destDir, keepFilter);
			}

			if (options.forceClearTempFiles && fs.existsSync(tempDir)) {
				this.logger.debug(chalk.gray(`Clearing temp dir: ${chalk.yellow(tempDir)}`));
				await fs.remove(tempDir);
			}

			this.logger.debug(chalk.gray(`Creating temp dir: ${chalk.yellow(tempDir)}`));
			await fs.ensureDir(tempDir);

			// Remove duplicate download tasks
			const uniqueKeys = new Set();
			const uniqueDownloads = downloads.filter(download => {
				const key = download.getKey();
				if (uniqueKeys.has(key)) {
					return false;
				}
				uniqueKeys.add(key);
				return true;
			});
			let numCompleted = 0;

			// Initialize progress meter
			const progressFormat = MediaDownloader.getProgressFormat('Downloading', 'files');
			progress = new cliProgress.Bar(
				{
					format: progressFormat
				},
				cliProgress.Presets.shades_classic
			);
			progress.start(uniqueDownloads.length, 0);

			// Make functions which return async functions
			// that will download a url when executed
			const taskFns = uniqueDownloads.map((download) => async () => {
				return this.download(download, tempDir, destDir, options)
					.then(async (tempFilePath) => {
						if (progress) {
							progress.update(++numCompleted);
						}

						return {
							url: download.url,
							tempFilePath,
							error: null
						};
					})
					.catch((error) => {
						// this.logger.error(error);
						if (options.abortOnError) {
							throw error;
						}

						if (progress) {
							progress.update(++numCompleted);
						}

						return {
							url: download.url,
							tempFilePath: null,
							error
						};
					});
			});

			// Run download queue
			await queue
				.addAll(taskFns)
				.then(async (results) => {
					// Finish progress animation before printing anything to console
					if (progress) {
						progress.stop();
					}
					// Return only errors
					return results.filter(r => !!r.error).map(r => r.error);
				})
				.then(async (errors) => {
					// Print any errors
					if (errors && errors.length > 0) {
						this.logger.error(
							`Encountered ${chalk.red(
								errors.length + ' error(s)'
							)} while downloading ${chalk.cyan(numCompleted + ' items')}`
						);
						for (const error of errors) {
							this.logger.error(chalk.red(error));
						}
					}
				})
				.then(async () => {
					if (options.clearOldFilesOnSuccess) {
						this.logger.debug(chalk.gray(`Removing old files from: ${chalk.yellow(destDir)}`));
						FileUtils.removeFilesFromDir(destDir, keepFilter);
					}

					this.logger.debug(chalk.gray(`Copying new files to: ${chalk.green(destDir)}`));
					fs.copySync(tempDir, destDir);

					this.logger.debug(chalk.gray(`Removing temp dir: ${chalk.yellow(tempDir)}`));
					fs.removeSync(tempDir);
				})
				.catch((reason) => {
					if (options.abortOnError) {
						throw new Error(reason);
					}
				});
			return Promise.resolve();
		} catch (error) {
			if (progress) {
				progress.stop();
			}
			const queueSize = queue.size;
			queue.clear();
			this.logger.error(
				`Cancelled ${chalk.red(queueSize + ' remaining sync tasks')} due to ${chalk.red('error')}:`
			);
			this.logger.error(chalk.red(error));

			if (tempDir && fs.existsSync(tempDir)) {
				this.logger.warn(`Removing temp dir at ${chalk.yellow(tempDir)} due to sync error`);
				fs.removeSync(tempDir);
			}
			return Promise.reject(error);
		}
	}

	/**
	 * @param {MediaDownload} task
	 * @param {string} tempDir Directory path for temporary files
	 * @param {string} destDir Directory path for final downloaded files
	 * @param {import('../content-options.js').ResolvedContentOptions} options Content and source options
	 * @returns {Promise<string|undefined>} Resolves with the downloaded file path
	 */
	async download(task, tempDir, destDir, options) {
		try {
			const localPath = task.localPath.replace(options.strip, '');
			const destPath = path.join(destDir, localPath);
			const tempFilePath = path.join(tempDir, localPath);
			const tempFilePathDir = path.dirname(tempFilePath);
			let isCached = false;

			fs.ensureDirSync(tempFilePathDir);

			const exists = fs.existsSync(destPath);
			const stats = exists ? fs.lstatSync(destPath) : null;

			// check for cached image first
			if (!options.ignoreCache && exists && stats && stats.isFile()) {
				if (options.enableIfModifiedSinceCheck || options.enableContentLengthCheck) {
					// Get just the file header to check for modified date and file size
					const response = await got.head(task.url, {
						headers: this._getRequestHeaders(destPath),
						timeout: {
							response: options.maxTimeout
						}
					});

					let isRemoteNew = false;

					if (options.enableIfModifiedSinceCheck) {
						// Remote file has been modified since the local file changed
						isRemoteNew = isRemoteNew || (response.statusCode !== 304);
					}

					if (options.enableContentLengthCheck && response.headers && response.headers['content-length']) {
						// Remote file has a different size than the local file
						const remoteSize = parseInt(response.headers['content-length']);
						const localSize = stats.size;
						isRemoteNew = isRemoteNew || (remoteSize !== localSize);
					}

					if (!isRemoteNew) {
						// copy existing, cached file from dest dir
						fs.copyFileSync(destPath, tempFilePath);
						isCached = true;
					}
				}
			}

			// download new or modified file
			if (!isCached) {
				await pipeline(
					got.stream(task.url, {
						timeout: {
							response: options.maxTimeout
						}
					}),
					fs.createWriteStream(tempFilePath)
				);
			}

			// apply optional transforms
			const ignoreTransformCache = options.ignoreImageTransformCache || !isCached;
			await this._transformImage(
				tempFilePath,
				destPath,
				options.imageTransforms,
				options.ignoreImageTransformErrors,
				ignoreTransformCache
			);

			return Promise.resolve(tempFilePath);
		} catch (error) {
			if (error instanceof Error) {
				return Promise.reject(
					new Error(`Download failed for ${task.url} due to error (${error.message || error})`)
				);
			}
		}
	}

	/**
	 * Progress format used for `cliProgress` bar
	 * @param {string} prefix Prepended to progress bar
	 * @param {string} tasksLabel Appended to the current/total count
	 * @returns {string}
	 */
	static getProgressFormat(prefix = '', tasksLabel = 'files') {
		prefix = prefix || 'Processing';
		return `${prefix} ${chalk.cyan('{value}/{total}')} ${tasksLabel}: ${chalk.cyan('{bar}')}`;
	}

	/**
	 * @typedef ImageTransform
	 * @property {number} [scale]
	 * @property {sharp.ResizeOptions} [resize]
	 * @property {number} [blur]
	 */

	/**
	 * 
	 * @param {string} tempFilePath The file path of the image to transform
	 * @param {string} cachedFilePath The path where the previous image would be cached
	 * @param {Array<ImageTransform>} transforms Array of image transform objects
	 * @param {boolean} ignoreErrors Silently fails if set to true (helpful if your media folder contains non-image files like 3D models)
	 * @param {boolean} ignoreCache Set to true to force creating a new image for each transform, even if it already exists under that name.
	 */
	async _transformImage(tempFilePath, cachedFilePath, transforms = [], ignoreErrors = true, ignoreCache = false) {
		for (const transform of transforms) {
			try {
				const image = sharp(tempFilePath);
				const metadata = await image.metadata();
				const operations = [];
				let suffix = '';

				if (transform.scale) {
					const scale = transform.scale;
					suffix += `@${scale}x`;
					operations.push(async () => this._scaleImage(image, metadata, scale));
				}

				if (transform.resize) {
					const resize = transform.resize;
					suffix += `@${resize.width}x${resize.height}`;
					if (resize.fit) {
						suffix += `-${resize.fit}`;
					}
					operations.push(async () => this._resizeImage(image, metadata, resize));
				}

				if (transform.blur) {
					const blur = transform.blur;
					suffix += `@blur_${blur}`;
					operations.push(async () => this._blurImage(image, metadata, blur));
				}

				const outputPath = FileUtils.addFilenameSuffix(tempFilePath, suffix);
				const cachedPath = FileUtils.addFilenameSuffix(cachedFilePath, suffix);

				if (!ignoreCache && suffix.length > 0 && fs.existsSync(cachedPath)) {
					this.logger.debug(`Using cached trasnformed image ${path.basename(outputPath)}`);
					await fs.copyFile(cachedPath, outputPath);
				} else {
					this.logger.debug(`Saving new transformed image ${path.basename(outputPath)}`);
					for (const operation of operations) {
						await operation();
					}
					await image.toFile(outputPath);
				}
			} catch (err) {
				if (!ignoreErrors) {
					this.logger.error(`Couldn't transform image ${tempFilePath}`);
					this.logger.error(err);
					throw err;
				}
			}
		}
	}

	/**
	 * 
	 * @param {sharp.Sharp} image 
	 * @param {sharp.Metadata} metadata 
	 * @param {number} scale 
	 * @returns {sharp.Sharp}
	 */
	_scaleImage(image, metadata, scale) {
		if (!metadata.width || !metadata.height) {
			throw new ImageTransformError('Image metadata is missing width or height');
		}

		return image.resize(
			Math.round(metadata.width * scale),
			Math.round(metadata.height * scale)
		);
	}

	/**
	 *
	 * @param {sharp.Sharp} image
	 * @param {sharp.Metadata} metadata
	 * @param {sharp.ResizeOptions} options Options for Sharp resize()
	 * @returns {sharp.Sharp}
	 */
	_resizeImage(image, metadata, options) {
		return image.resize(options);
	}

	/**
	 *
	 * @param {sharp.Sharp} image
	 * @param {sharp.Metadata} metadata
	 * @param {number} amount Amount of blur in px
	 * @returns {sharp.Sharp}
	 */
	_blurImage(image, metadata, amount) {
		return image.blur(amount);
	}

	/**
	 * @param {string} filePath
	 */
	_getRequestHeaders(filePath) {
		if (fs.existsSync(filePath)) {
			return {
				'If-Modified-Since': FileUtils.getModifiedDate(filePath).toUTCString()
			};
		}
		return {};
	}
}

export default MediaDownloader;

class ImageTransformError extends Error {
	/**
	 * @param {string} [message] 
	 * @param  {...any} args 
	 */
	constructor(message = '', ...args) {
		super(message, ...args);
	}
}
