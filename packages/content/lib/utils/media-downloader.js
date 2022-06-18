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
   * @param {Iterable<string>} urls
   * @param {ContentOptions} options
   */
  async sync(urls, options) {
    this.logger.info(`Syncing ${chalk.cyan(urls.length)} files`);

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

      let uniqueUrls = [...new Set(urls)];
      let numCompleted = 0;

      const progressFormat = Constants.getProgressFormat('Downloading', 'files');
      progress = new cliProgress.Bar(
        {
          format: progressFormat
        },
        cliProgress.Presets.shades_classic
      );
      progress.start(uniqueUrls.length, 0);

      // make functions which return async functions
      // that will download a url when executed
      let tasks = uniqueUrls.map((urlString) => async () => {
        return this.download(urlString, tempDir, destDir, options)
          .then(async (tempFilePath) => {
            progress.update(++numCompleted);
            return {
              url: urlString,
              tempFilePath: tempFilePath,
              error: null
            };
          })
          .catch((error) => {
            if (options.abortOnError) {
              throw error;
            }
            progress.update(++numCompleted);
            return {
              url: urlString,
              tempFilePath: null,
              error: error
            };
          });
      });

      await queue
        .addAll(tasks)
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
   * @param {string} urlString
   * @param {string} tempDir
   * @param {string} destDir
   * @param {ContentOptions} options
   * @returns @type {Promise<string>} Resolves with the downloaded file path
   */
  async download(urlString, tempDir, destDir, options) {
    try {
      let relativePath = new URL(urlString).pathname.replace(options.strip, '');
      let destPath = path.join(destDir, relativePath);
      let tempFilePath = path.join(tempDir, relativePath);
      let tempFilePathDir = path.dirname(tempFilePath);
      let isCached = false;
      fs.ensureDirSync(tempFilePathDir);

      // check for cached image first
      if (!options.ignoreCache && fs.existsSync(destPath) && fs.lstatSync(destPath).isFile()) {
        let response = null;

        if (!options.skipModifiedCheck) {
          response = await got.head(urlString, {
            // check if we have the file on cache
            headers: this._getRequestHeaders(destPath),
            timeout: 30000, // ms
          });
        }

        if (options.skipModifiedCheck || response.statusCode === 304) {
          // copy existing, cached file from dest dir
          fs.copyFileSync(destPath, tempFilePath);
          isCached = true;
        }
      }

      // download new or modified file
      if (!isCached) {
        await pipeline(
          got.stream(urlString, {
            timeout: {
              response: 30000, // ms for initial response
            },
          }),
          fs.createWriteStream(tempFilePath)
        );
      }

      // apply optional transforms
      await this._transformImage(tempFilePath, tempFilePathDir, options.imageTransforms, options.ignoreImageTransformErrors);

      return Promise.resolve(tempFilePath);

    } catch (error) {
      return Promise.reject(
        new Error(`Download failed for ${urlString} due to error (${error.message || error})`)
      );
    }
  }

  /**
   *
   * @param {string} tempFilePath
   * @param {string} tempFilePathDir
   * @param {Array<Object>} imageTransforms
   * @param {boolean} ignoreErrors
   */
  async _transformImage(tempFilePath, tempFilePathDir, imageTransforms = [], ignoreErrors = true) {
    for (const transform of imageTransforms) {
      try {
        const filename = path.basename(tempFilePath);
        const extension = path.extname(tempFilePath);
        const filenameNoExt = filename.slice(0, -extension.length);
        const image = sharp(tempFilePath);
        const metadata = await image.metadata();
        let outputPath = path.join(tempFilePathDir, `${filenameNoExt}`)

        if (transform.scale) {
          outputPath += `@${transform.scale}x`;
          await this._scaleImage(image, metadata, transform.scale);
        }
        else if (transform.resize) {
          outputPath += `@${transform.resize.width}x${transform.resize.height}`;
          if (transform.resize.fit) {
            outputPath += `-${transform.resize.fit}`;
          }
          await this._resizeImage(image, metadata, transform.resize);
        }

        await image.toFile(`${outputPath}${extension}`);

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
   * @param {object} resize, obtions object for Sharp resize()
   * @returns {Promise<sharp.Sharp>}
   */
  _resizeImage(image, metadata, resize) {
    return image.resize(
      resize
    );
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
