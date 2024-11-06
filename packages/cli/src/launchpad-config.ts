import type { ContentConfig } from "@bluecadet/launchpad-content";
import type { MonitorConfig } from "@bluecadet/launchpad-monitor";
import type { LogConfig } from "../../utils/src/log-manager.js";

export type LaunchpadConfig = {
	content?: ContentConfig;
	monitor?: MonitorConfig;
	logging?: LogConfig;
};

/**
 * Applies defaults to the provided launchpad config.
 */
export function resolveLaunchpadConfig(config: LaunchpadConfig) {
	// NOTE: at the moment, there are no defaults to apply
	// so this function is just a passthrough
	return config;
}

export type ResolvedLaunchpadOptions = ReturnType<typeof resolveLaunchpadConfig>;

/**
 * Type definition for the config object.
 */
export function defineConfig(config: LaunchpadConfig) {
	return config;
}
