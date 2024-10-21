import chalk from 'chalk';
import ky from 'ky';
import { err, ok } from 'neverthrow';
import { defineSource } from './source.js';

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
	return ok(defineSource({
		id,
		fetch: async (ctx) => {
			const resultMap = new Map();
			for (const [key, url] of Object.entries(files)) {
				ctx.logger.debug(`Downloading json ${chalk.blue(url)}`);
				const response = await ky(url, {
					timeout: maxTimeout
				});

				if (!response.ok) {
					return err(`Could not fetch json from ${url}`);
				}

				try {
					const json = await response.json();
					resultMap.set(key, json);
				} catch (error) {
					return err(`Could not parse json from ${url}`);
				}
			}

			return ok(resultMap);
		}
	}));
}
