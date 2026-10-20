import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import { durationSchema } from "@bluecadet/launchpad-utils/duration";
import { ResultAsync } from "neverthrow";
import { z } from "zod";
import type { ContentTransform } from "./content-transform.js";
import { ContentError } from "./content-transform.js";
import { type ContentSource, contentSourceSchema } from "./source.js";

export type ConfigContentSource = ContentSource | Promise<ContentSource>;

/** Options for versioned output mode. */
export interface VersioningOptions {
	/** Number of versions to retain, in addition to the active version and any freshly-leased versions. `0` relies solely on the active-version and fresh-ack backstops. Defaults to `3`. */
	keepVersions?: number;
	/** How long an ack lease (`acks/<consumerId>.json`) stays fresh before the retention sweep ignores it. Accepts duration shorthand (e.g. `"30m"`) or milliseconds. Defaults to 30 minutes. */
	ackTimeout?: string | number;
}

/** Configuration for content sources and plugins. */
export interface ContentConfig {
	/** A list of content source options. This defines which content is downloaded from where. */
	sources?: ConfigContentSource[];
	/** A list of content transforms to run after fetching. */
	transforms?: ContentTransform[];
	/** The path where successfully promoted content is published. Defaults to `".downloads/"`. */
	downloadPath?: string;
	/** Temp file directory path. Defaults to `".launchpad/tmp/"`. */
	tempPath?: string;
	/** Temp directory path where all downloaded content will be backed up before removal. Defaults to `".launchpad/backup/"`. */
	backupPath?: string;
	/** Glob patterns for files to preserve when clearing directories. */
	keep?: string[];
	/** Compatibility recovery mode: back up published files before a fetch run. Defaults to `true`. */
	backupAndRestore?: boolean;
	/** Max request timeout in ms. Defaults to `30000`. */
	maxTimeout?: number;
	/** Characters to encode in local file paths. Defaults to `<>:"|?*`. */
	encodeChars?: string;
	/** Enables versioned output mode. Pass `true` for defaults or an object to override them. Defaults to `false`. */
	versioning?: boolean | VersioningOptions;
}

const versioningOptionsSchema = configSchema<VersioningOptions>()(
	z.object({
		keepVersions: z
			.number()
			.int()
			.min(0)
			.describe(
				"Number of versions to retain, in addition to the active version and fresh acks. 0 relies solely on those backstops.",
			)
			.default(3),
		ackTimeout: durationSchema
			.describe(
				"How long an ack lease stays fresh before the retention sweep ignores it. Accepts duration shorthand or milliseconds.",
			)
			.prefault("30m"),
	}),
);

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
export const contentConfigSchema = configSchema<ContentConfig>()(
	z.object({
		sources: z
			.array(z.union([contentSourceSchema, z.promise(contentSourceSchema)]))
			.transform(async (sources) => {
				return Promise.all(sources);
			})
			.describe(
				"Content sources to download from; accepts source objects or promises resolving to sources.",
			)
			.prefault([]),
		transforms: z
			.array(z.custom<ContentTransform>().meta({ configDocs: { inputType: "ContentTransform" } }))
			.describe("A list of content transforms to run after fetching.")
			.default([]),
		downloadPath: z
			.string()
			.describe(
				"Published content directory. Fetch runs stage work separately before promotion; relative paths resolve from the config directory.",
			)
			.default(".downloads/"),
		tempPath: z
			.string()
			.describe(
				"Temporary directory for per-run staged workspaces; relative paths resolve from the config directory.",
			)
			.default(".launchpad/tmp/"),
		backupPath: z
			.string()
			.describe(
				"Backup directory for compatibility recovery flows; relative paths resolve from the config directory.",
			)
			.default(".launchpad/backup/"),
		keep: z
			.array(z.string())
			.describe("Glob patterns for files to preserve when clearing directories.")
			.default([]),
		backupAndRestore: z
			.boolean()
			.describe(
				"Back up published files before fetching for compatibility recovery. Normal fetch failures discard staged output without restoring backups.",
			)
			.default(true),
		maxTimeout: z
			.number()
			.describe("Maximum network request timeout in milliseconds.")
			.default(30000),
		encodeChars: z
			.string()
			.describe("Characters to encode in local file paths for content and media downloads.")
			.default('<>:"|?*'),
		versioning: versioningSchema
			.describe(
				"Enable immutable versioned output with an atomic manifest pointer. Pass true for resolved defaults, an object for overrides, or false for flat output.",
			)
			.default(false),
	}),
);

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
