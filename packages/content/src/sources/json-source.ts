import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import chalk from "chalk";
import ky from "ky";
import { z } from "zod";
import { defineSource } from "../source.js";

/** Options for the JSON source. */
export interface JsonSourceOptions {
	/** Required field to identify this source. Will be used as download path. */
	id: string;
	/** A mapping of json key -> url */
	files: Record<string, string>;
	/** Max request timeout in ms. Defaults to 30 seconds. */
	maxTimeout?: number;
}

const jsonSourceSchema = configSchema<JsonSourceOptions>()(
	z.object({
		id: z
			.string()
			.describe("Required field to identify this source. Will be used as download path."),
		files: z.record(z.string(), z.string()).describe("A mapping of json key -> url"),
		maxTimeout: z.number().describe("Max request timeout in ms.").default(30_000),
	}),
);

export function jsonSource(options: JsonSourceOptions) {
	const parsedOptions = jsonSourceSchema.parse(options);

	return defineSource({
		id: parsedOptions.id,
		fetch: (ctx) => {
			return Object.entries(parsedOptions.files).map(([key, url]) => {
				ctx.logger.verbose(`Downloading json ${chalk.blue(url)}`);
				return {
					id: key,
					data: ky
						.get(url, {
							timeout: parsedOptions.maxTimeout,
							signal: ctx.abortSignal,
						})
						.json(),
				};
			});
		},
	});
}
