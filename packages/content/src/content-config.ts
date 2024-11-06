import type { ContentPlugin } from "./content-plugin-driver.js";
import type { ContentSource, ContentSourceBuilder } from "./sources/source.js";

export const DOWNLOAD_PATH_TOKEN = "%DOWNLOAD_PATH%";
export const TIMESTAMP_TOKEN = "%TIMESTAMP%";

export type ConfigContentSource = ContentSource | Promise<ContentSource> | ReturnType<ContentSourceBuilder<unknown>>;

export type ContentConfig = {
	/**
	 * A list of content source options. This defines which content is downloaded from where.
	 */
	sources?: ConfigContentSource[];
	/**
	 * A list of content plugin.
	 */
	plugins?: ContentPlugin[];
	/**
	 * The path at which to store all downloaded files. Defaults to '.downloads/'.
	 */
	downloadPath?: string;
	/**
	 * Temp file directory path. Defaults to '%DOWNLOAD_PATH%/.tmp/'.
	 */
	tempPath?: string;
	/**
	 * Temp directory path where all downloaded content will be backed up before removal. Defaults to '%TIMESTAMP%/.tmp-backup/'.
	 */
	backupPath?: string;
	/**
	 * Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. `['*.json', '** /*.csv', '*.xml', '*.git*']`
	 */
	keep?: string[];
	/**
	 * Strips this string from all media file paths when saving them locally
	 */
	strip?: string;
	/**
	 * Back up files before downloading and restore originals for all sources on failure of any single source. Defaults to true.
	 */
	backupAndRestore?: boolean;
	/**
	 * Max request timeout in ms. Defaults to 30000.
	 */
	maxTimeout?: number;
	/**
	 * Characters to encode in the path when saving files locally. Defaults to `<>:"|?*`. Applies to both content source paths and media download paths.
	 */
	encodeChars?: string;
};

export const CONTENT_CONFIG_DEFAULTS = {
	sources: [],
	plugins: [],
	downloadPath: ".downloads/",
	tempPath: "%DOWNLOAD_PATH%/.tmp/",
	backupPath: ".tmp-backup/%TIMESTAMP%/",
	keep: [],
	strip: "",
	backupAndRestore: true,
	maxTimeout: 30000,
	encodeChars: '<>:"|?*',
} satisfies ContentConfig;

/**
 * Apply defaults to passed content config
 */
export function resolveContentConfig(config: ContentConfig) {
	return {
		...CONTENT_CONFIG_DEFAULTS,
		...config,
	};
}

export type ResolvedContentConfig = ReturnType<typeof resolveContentConfig>;

/**
 * Type helper to define content config.
 */
export function defineContentConfig(config: ContentConfig) {
	return config;
}
