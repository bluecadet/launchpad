import chalk from 'chalk';
import ky from 'ky';
import { err, ok, okAsync, ResultAsync } from 'neverthrow';
import { defineSource } from './source.js';
import { fetchError, parseError } from './source-errors.js';

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
			const promises = Object.entries(files).map(
				([key, url]) => {
					ctx.logger.debug(`Downloading json ${chalk.blue(url)}`);
					return ResultAsync.fromPromise(
						ky(url, {
							timeout: maxTimeout
						}),
						() => fetchError(`Could not fetch json from ${url}`)
					).andThen(
						res => {
							if (!res.ok) {
								return err(fetchError(`Could not fetch json from ${url}`));
							}
						
							return ResultAsync.fromThrowable(res.json, e => parseError(`Could not parse json from ${url}`))();
						}
					).andThen(json => ok({
						key,
						json
					}));
				}
			);

			return ResultAsync.combine(promises).andThen(data => {
				const resultMap = new Map();

				data.forEach(({ key, json }) => {
					resultMap.set(key, json);
				});

				return ok(resultMap);
			});
		}
	}));
}
