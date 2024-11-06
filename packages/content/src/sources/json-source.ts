import chalk from "chalk";
import { okAsync } from "neverthrow";
import { defineSource } from "./source.js";
import { z } from "zod";
import ky from "ky";

const jsonSourceSchema = z.object({
	/** required field to identify this source. Will be used as download path. */
	id: z.string().describe("Required field to identify this source. Will be used as download path."),
	/** A mapping of json key -> url */
	files: z.record(z.string(), z.string()).describe("A mapping of json key -> url"),
	/** Max request timeout in ms. Defaults to 30 seconds. */
	maxTimeout: z.number().describe("Max request timeout in ms.").default(30_000),
});

export default function jsonSource(options: z.input<typeof jsonSourceSchema>) {
	const parsedOptions = jsonSourceSchema.parse(options);

	return defineSource({
		id: parsedOptions.id,
		fetch: (ctx) => {
			return Object.entries(parsedOptions.files).map(([key, url]) => {
				ctx.logger.debug(`Downloading json ${chalk.blue(url)}`);

				return {
					id: key,
					data: ky.get(url, { timeout: parsedOptions.maxTimeout }).json(),
				};
			});
		},
	});
}
