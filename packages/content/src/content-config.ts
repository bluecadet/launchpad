import { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { ContentTransform } from "./content-transform.js";
import { ContentError } from "./content-transform.js";
import { type ContentSource, contentSourceSchema } from "./source.js";

export type ConfigContentSource = ContentSource | Promise<ContentSource>;

/**
 * Configuration for content sources and plugins.
 */
export const contentConfigSchema = z.object({
	/** A list of content source options. This defines which content is downloaded from where. */
	sources: z
		.array(z.union([contentSourceSchema, z.promise(contentSourceSchema)]))
		.transform(async (sources) => {
			return Promise.all(sources);
		})
		.describe(
			"A list of content source options. This defines which content is downloaded from where.",
		)
		.default([]),
	/** A list of content transforms to run after fetching. */
	transforms: z
		.array(z.custom<ContentTransform>())
		.describe("A list of content transforms to run after fetching.")
		.default([]),
	/** The path at which to store all downloaded files. Defaults to '.downloads/'. */
	downloadPath: z
		.string()
		.describe("The path at which to store all downloaded files. Defaults to '.downloads/'.")
		.default(".downloads/"),
	/** Temp file directory path. Defaults to '.launchpad/tmp/'. */
	tempPath: z
		.string()
		.describe("Temp file directory path. Defaults to '.launchpad/tmp/'.")
		.default(".launchpad/tmp/"),
	/** Temp directory path where all downloaded content will be backed up before removal. Defaults to '.launchpad/backup/'. */
	backupPath: z
		.string()
		.describe(
			"Temp directory path where all downloaded content will be backed up before removal. Defaults to '.launchpad/backup/'.",
		)
		.default(".launchpad/backup/"),
	/** Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. `['*.json', '** /*.csv', '*.xml', '*.git*']` */
	keep: z
		.array(z.string())
		.describe(
			"Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. `['*.json', '** /*.csv', '*.xml', '*.git*']`",
		)
		.default([]),
	/** Back up files before downloading and restore originals for all sources on failure of any single source. Defaults to true. */
	backupAndRestore: z
		.boolean()
		.describe(
			"Back up files before downloading and restore originals for all sources on failure of any single source. Defaults to true.",
		)
		.default(true),
	/** Max request timeout in ms. Defaults to 30000. */
	maxTimeout: z.number().describe("Max request timeout in ms. Defaults to 30000.").default(30000),
	/** Characters to encode in the path when saving files locally. Defaults to `<>:\"|?*`. Applies to both content source paths and media download paths. */
	encodeChars: z
		.string()
		.describe(
			'Characters to encode in the path when saving files locally. Defaults to `<>:"|?*`. Applies to both content source paths and media download paths.',
		)
		.default('<>:"|?*'),
});

export type ContentConfig = z.input<typeof contentConfigSchema>;

export type ResolvedContentConfig = z.output<typeof contentConfigSchema>;

/**
 * Type helper to define content config.
 */
export function defineContentConfig(config: ContentConfig) {
	return config;
}

export function parseContentConfig(config: ContentConfig) {
	return ResultAsync.fromPromise(
		contentConfigSchema.parseAsync(config),
		(e) => new ContentError("Invalid content config", { cause: e }),
	);
}
