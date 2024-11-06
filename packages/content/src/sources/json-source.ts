import chalk from "chalk";
import { ok, okAsync } from "neverthrow";
import { SafeKyParseError, safeKy } from "../utils/safe-ky.js";
import { SourceFetchError, SourceParseError, defineSource } from "./source.js";

type JsonSourceOptions = {
	/**
	 * Required field to identify this source. Will be used as download path.
	 */
	id: string;
	/**
	 * A mapping of json key -> url
	 */
	files: Record<string, string>;
	/**
	 * Max request timeout in ms. Defaults to 30 seconds.
	 */
	maxTimeout?: number;
};

export default function jsonSource(options: JsonSourceOptions) {
	return okAsync(
		defineSource({
			id: options.id,
			fetch: (ctx) => {
				const jsonFetchPromises = Object.entries(options.files).map(([key, url]) => {
					ctx.logger.debug(`Downloading json ${chalk.blue(url)}`);
					return {
						id: key,
						dataPromise: safeKy(url, { timeout: options.maxTimeout })
							.json()
							.mapErr((e) => {
								if (e instanceof SafeKyParseError) {
									return new SourceParseError(`Could not parse json from ${url}`, { cause: e });
								}
								return new SourceFetchError(`Could not fetch json from ${url}`, { cause: e });
							})
							.map((data) => {
								return [
									{
										id: key,
										data,
									},
								];
							}),
					};
				});
				return ok(jsonFetchPromises);
			},
		}),
	);
}
