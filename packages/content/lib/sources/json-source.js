import chalk from 'chalk';
import { ok, okAsync } from 'neverthrow';
import { defineSource } from './source.js';
import { fetchError, parseError } from './source-errors.js';
import { safeKy, SafeKyError } from '../utils/safe-ky.js';

/**
 * @typedef {object} JsonSourceOptions
 * @prop {string} id Required field to identify this source. Will be used as download path.
 * @prop {Record<string, string>} files A mapping of json key -> url
 * @prop {number} [maxTimeout] Max request timeout in ms. Defaults to 30 seconds.
 */

/**
 * @type {import("./source.js").ContentSourceBuilder<JsonSourceOptions>}
 */
export default function jsonSource({ id, files, maxTimeout = 30_000 }) {
	return okAsync(defineSource({
		id,
		fetch: (ctx) => {
			const jsonFetchPromises = Object.entries(files).map(
				([key, url]) => {
					ctx.logger.debug(`Downloading json ${chalk.blue(url)}`);
					return {
						id: key,
						dataPromise: safeKy(url, { timeout: maxTimeout }).json()
							.mapErr((e) => {
								if (e instanceof SafeKyError.ParseError) {
									return parseError(e.message);
								}
								return fetchError(e.message);
							})
							.map(data => {
								return [{
									id: key,
									data
								}]
							})
					}
				}
			)
			return ok(jsonFetchPromises);
		}
	}));
}
