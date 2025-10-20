import type { ContentConfig } from "@bluecadet/launchpad-content";
import { type ControllerConfig, controllerConfigSchema } from "@bluecadet/launchpad-controller";
import type { MonitorConfig } from "@bluecadet/launchpad-monitor";
import type { LogConfig } from "@bluecadet/launchpad-utils";

export type LaunchpadConfig = {
	controller?: ControllerConfig;
	content?: ContentConfig;
	monitor?: MonitorConfig;
	logging?: LogConfig;
};

/**
 * Applies defaults to the provided launchpad config.
 */
export function resolveLaunchpadConfig(config: LaunchpadConfig) {
	return {
		...config,
		// Apply controller config defaults via Zod schema
		controller: controllerConfigSchema.parse(config.controller),
	};
}

export type ResolvedLaunchpadOptions = ReturnType<typeof resolveLaunchpadConfig>;

/**
 * Type definition for the config object.
 */
export function defineConfig(config: LaunchpadConfig) {
	return config;
}
