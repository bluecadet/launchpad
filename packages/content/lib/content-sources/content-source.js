/**
 * @module content-source
 */

import chalk from 'chalk';
import { Logger } from '@bluecadet/launchpad-utils';
import ContentResult from './content-result.js';

export const IMAGE_REGEX = /.+(\.jpg|\.jpeg|\.png)/gi;
export const VIDEO_REGEX = /.+(\.avi|\.mov|\.mp4|\.mpg|\.mpeg)/gi;
export const MEDIA_REGEX = new RegExp(`(${IMAGE_REGEX.source})|(${VIDEO_REGEX.source})`);

/**
 * @template T
 * @typedef {Required<{[K in keyof T as  T extends Record<K, T[K]> ? never : K]: T[K]}>} SelectOptional Select only the optional properties of a type.
 * @example
 * type Foo = { a: string, b?: number };
 * type OptionalFoo = SelectOptional<Foo>; // { b: number }
 */

/**
 * @template {string} T
 * @typedef SourceOptions
 * @property {string} id Required field to identify this source. Will be used as download path.
 * @property {T} type The type of content source. Used internally to determine which source class to use.
 */

/**
 * @template {SourceOptions<string>} [C=SourceOptions<string>]
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
