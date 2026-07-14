import { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { ContentTransform } from "./content-transform.js";
import { ContentError } from "./content-transform.js";
import { type ContentSource, contentSourceSchema } from "./source.js";
import { durationSchema, parseDuration } from "./utils/duration.js";

export type ConfigContentSource = ContentSource | Promise<ContentSource>;

const versioningOptionsSchema = z.object({
	/** Number of versions to retain (in addition to the active version and any freshly-leased versions). Defaults to 3. */
	keep: z.number().describe("Number of versions to retain. Defaults to 3.").default(3),
	/** How long an ack lease (`acks/<consumerId>.json`) stays fresh before it's ignored by the retention sweep. Accepts duration shorthand (e.g. `"30m"`) or a raw millisecond number. Defaults to 30 minutes. */
	ackTimeout: durationSchema
		.describe(
			"How long an ack lease stays fresh before it's ignored by the retention sweep. Accepts duration shorthand (e.g. '30m') or a raw millisecond number. Defaults to 30 minutes.",
		)
		.default(parseDuration("30m")),
});

const versioningSchema = z.union([z.boolean(), versioningOptionsSchema]).transform((value) => {
	if (value === false) {
		return false as const;
	}
	if (value === true) {
		return versioningOptionsSchema.parse({});
	}
	return value;
});

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
		.prefault([]),
	/** A list of content transforms to run after fetching. */
	transforms: z
		.array(z.custom<ContentTransform>())
		.describe("A list of content transforms to run after fetching.")
		.default([]),
	/** The path where successfully promoted content is published. Fetch runs stage work in an isolated temp run directory before promotion. Defaults to '.downloads/'. */
	downloadPath: z
		.string()
		.describe(
			"The path where successfully promoted content is published. Fetch runs stage work in an isolated temp run directory before promotion. Defaults to '.downloads/'.",
		)
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
	/** Compatibility recovery mode. When enabled, published files are backed up before a fetch run and can be restored if promotion or recovery fails. Normal fetch rollback does not rely on backups because runs stage output before promotion. Defaults to true. */
	backupAndRestore: z
		.boolean()
		.describe(
			"Compatibility recovery mode. When enabled, published files are backed up before a fetch run and can be restored if promotion or recovery fails. Normal fetch rollback does not rely on backups because runs stage output before promotion. Defaults to true.",
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
	/** Enables versioned output mode: each successful fetch is promoted into an immutable `versions/<versionId>/` directory with an atomically-swapped `manifest.json` pointer, instead of writing directly into `downloadPath`. Pass `true` for defaults, or an object to override `keep`/`ackTimeout`. Defaults to `false` (today's flat `downloadPath` layout). */
	versioning: versioningSchema
		.describe(
			"Enables versioned output mode: each successful fetch is promoted into an immutable `versions/<versionId>/` directory with an atomically-swapped `manifest.json` pointer, instead of writing directly into `downloadPath`. Pass `true` for defaults, or an object to override `keep`/`ackTimeout`. Defaults to `false` (today's flat `downloadPath` layout).",
		)
		.default(false),
});

export type ContentConfig = z.input<typeof contentConfigSchema>;

export type ResolvedContentConfig = z.output<typeof contentConfigSchema>;

export type ResolvedVersioningConfig = ResolvedContentConfig["versioning"];

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
