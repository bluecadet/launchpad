/**
 * @module content-source
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import { Logger } from '@bluecadet/launchpad-utils';
import ContentResult from './content-result.js';

/**
 * Base class for all content sources. `id` is mandatory.
 */
export class SourceOptions {
	static get IMAGE_REGEX() {
		return /.+(\.jpg|\.jpeg|\.png)/gi;
	}
	
	static get VIDEO_REGEX() {
		return /.+(\.avi|\.mov|\.mp4|\.mpg|\.mpeg)/gi;
	}
	
	static get MEDIA_REGEX() {
		return new RegExp(`(${SourceOptions.IMAGE_REGEX.source})|(${SourceOptions.VIDEO_REGEX.source})`);
	}
	
	constructor({
		id = '',
		...rest
	} = {}) {
		/**
		 * Required field to identify this source. Will be used as download path.
		 * @type {string}
		 */
		this.id = id;
		
		// Allows for additional properties to be inherited
		Object.assign(this, rest);
	}
}

/**
 * @template {SourceOptions} [C=SourceOptions]
 */
export class ContentSource {
	/** @type {C} */
	config;
	/** @type {Logger | Console} */
	logger;
	
	/**
	 * @param {C} config Content source options. `id` is a required field.
	 * @param {Logger} [logger] The logger to use for all output. Defaults to console.
	 * @throws {Error} Throws an error if no `config` or `config.id` is defined.
	 */
	constructor(config, logger) {
		this.logger = logger ?? console;
		this.config = config;
		
		if (!this.config || !this.config.id) {
			throw new Error('Content source has no ID. This is a required field.');
		}
	}
	
	/**
	 * Downloads data content and gathers media urls.
	 * 
	 * @returns {Promise<ContentResult>} that resolves only when all content has been downloaded successfully
	 */
	async fetchContent() {
		throw new Error(`Downloading functionality not implemented for '${chalk.yellow(this.config.id)}'`);
	}
	
	/**
	 * Removes all content and media files in the temp and dest directories (temp first, then dest).
	 * 
	 * @returns {Promise<void>}
	 */
	async clearContent() {
		throw new Error('clearContent not implemented');
	}
	
	toString() {
		return this.config ? this.config.id : '[ContentSource]';
	}
}

export default ContentSource;
