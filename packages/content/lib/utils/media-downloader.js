import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import stream from 'stream';
const pipeline = promisify(stream.pipeline);

import chalk from 'chalk';
import got from 'got'; // http requests
import sharp from 'sharp'; // image manipulation
import cliProgress from 'cli-progress';

import FileUtils from './file-utils.js';
import Constants from './constants.js';
import { ContentOptions } from '../content-options.js';
import { MediaDownload } from '../content-sources/content-result.js';

let PQueue = null; // Future import


/**
 * Downloads a batch of urls to a target directory.
 * Existing files will be compared for date and size.
 * If an error occurs, content is rolled back to its original state.
 */
export class MediaDownloader {
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
   * @param {ContentOptions} options
   */
  async sync(downloads, options) {
    this.logger.info(`Syncing ${chalk.cyan(downloads.length)} files`);
    
    if (!PQueue) {
      // @see https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c#pure-esm-package
      PQueue = (await import('p-queue')).default;
    }
    const queue = new PQueue({
      concurrency: options.maxConcurrent || 4,
    });
    
    let tempDir = '';
    let progress = null;

    try {
      const destDir = path.resolve(options.downloadPath);
      const tempDir = path.resolve(options.tempPath);

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
      let uniqueKeys = new Set();
      let uniqueDownloads = downloads.filter(download => {
        const key = download.getKey();
        if (uniqueKeys.has(key)) {
          return false;
        }
        uniqueKeys.add(key);
        return true;
      });
      let numCompleted = 0;
      
      // Initialize progress meter
      const progressFormat = Constants.getProgressFormat('Downloading', 'files');
      progress = new cliProgress.Bar(
        {
          format: progressFormat
        },
        cliProgress.Presets.shades_classic
      );
      progress.start(uniqueDownloads.length, 0);
      
      // Make functions which return async functions
      // that will download a url when executed
      let taskFns = uniqueDownloads.map((download) => async () => {
        return this.download(download, tempDir, destDir, options)
          .then(async (tempFilePath) => {
            progress.update(++numCompleted);
            return {
              url: download.url,
              tempFilePath: tempFilePath,
              error: null
            };
          })
          .catch((error) => {
            // this.logger.error(error);
            if (options.abortOnError) {
              throw error;
            }
            progress.update(++numCompleted);
            return {
              url: download.url,
              tempFilePath: null,
              error: error
            };
          });
      });
      
      // Run download queue
      await queue
        .addAll(taskFns)
        .then(async (results) => {
          // Finish progress animation before printing anything to console
          progress.stop();
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
   * @param {ContentOptions} options Content and source options
   * @returns {Promise<string>} Resolves with the downloaded file path
   */
  async download(task, tempDir, destDir, options) {
    try {
      let localPath = task.localPath.replace(options.strip, '');
      let destPath = path.join(destDir, localPath);
      let tempFilePath = path.join(tempDir, localPath);
      let tempFilePathDir = path.dirname(tempFilePath);
      let isCached = false;
      
      fs.ensureDirSync(tempFilePathDir);
      
      const exists = fs.existsSync(destPath);
      const stats = exists ? fs.lstatSync(destPath) : null;
      
      // check for cached image first
      if (!options.ignoreCache && exists && stats.isFile()) {
        let response = null;
        
        if (options.enableIfModifiedSinceCheck || options.enableContentLengthCheck) {
          // Get just the file header to check for modified date and file size
          response = await got.head(task.url, {
            headers: this._getRequestHeaders(destPath),
            timeout: {
              response: options.maxTimeout
            }
          });
        }
        
        let isRemoteNew = false;
        
        if (options.enableIfModifiedSinceCheck) {
          // Remote file has been modified since the local file changed
          isRemoteNew = isRemoteNew || (response.statusCode !== 304);
        }
        
        if (options.enableContentLengthCheck && response.headers && response.headers['content-length']) {
          // Remote file has a different size than the local file
          const remoteSize = parseInt(response.headers['content-length']);
          const localSize  = stats.size;
          isRemoteNew = isRemoteNew || (remoteSize !== localSize);
        }
        
        if (!isRemoteNew) {
          // copy existing, cached file from dest dir
          fs.copyFileSync(destPath, tempFilePath);
          isCached = true;
        }
      }

      // download new or modified file
      if (!isCached) {
        await pipeline(
          got.stream(task.url, {
            timeout: {
              response: options.maxTimeout
            },
          }),
          fs.createWriteStream(tempFilePath)
        );
      }
      
      // apply optional transforms
      await this._transformImage(tempFilePath, options.imageTransforms, options.ignoreImageTransformErrors);
      
      return Promise.resolve(tempFilePath);
      
    } catch (error) {
      return Promise.reject(
        new Error(`Download failed for ${task.url} due to error (${error.message || error})`)
      );
    }
  }
  
  /**
   * 
   * @param {string} tempFilePath 
   * @param {Array<Object>} imageTransforms 
   * @param {boolean} ignoreErrors
   */
  async _transformImage(tempFilePath, imageTransforms = [], ignoreErrors = true) {
    for (const transform of imageTransforms) {
      try {
        const image = sharp(tempFilePath);
        const metadata = await image.metadata();
        let suffix = '';
        
        if (transform.scale) {
          suffix += `@${transform.scale}x`;
          await this._scaleImage(image, metadata, transform.scale);
        }
        
        if (transform.resize) {
          suffix += `@${transform.resize.width}x${transform.resize.height}`;
          if (transform.resize.fit) {
            suffix += `-${transform.resize.fit}`;
          }
          await this._resizeImage(image, metadata, transform.resize);
        }
        
        if (transform.blur) {
          suffix += `@blur_${transform.blur}`;
          await this._blurImage(image, metadata, transform.blur);
        }
        
        const outputPath = FileUtils.addFilenameSuffix(tempFilePath, suffix);
        await image.toFile(outputPath);
        
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
   * @returns {Promise<sharp.Sharp>}
   */
  _scaleImage(image, metadata, scale) {
    return image.resize(
      Math.round(metadata.width * scale),
      Math.round(metadata.height * scale)
    );
  }

  /**
   *
   * @param {sharp.Sharp} image
   * @param {sharp.Metadata} metadata
   * @param {object} options Options for Sharp resize()
   * @returns {Promise<sharp.Sharp>}
   */
  _resizeImage(image, metadata, options) {
    return image.resize(options);
  }

  /**
   *
   * @param {sharp.Sharp} image
   * @param {sharp.Metadata} metadata
   * @param {object} amount Amount of blur in px
   * @returns {Promise<sharp.Sharp>}
   */
  _blurImage(image, metadata, amount) {
    return image.blur(amount);
  }

  _getRequestHeaders(filePath) {
    if (fs.existsSync(filePath)) {
      return {
        'If-Modified-Since': FileUtils.getModifiedDate(filePath).toUTCString(),
      };
    }
    return {};
  }
}

export default MediaDownloader;
