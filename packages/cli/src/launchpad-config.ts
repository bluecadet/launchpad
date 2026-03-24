import {
	type ControllerConfig,
	controllerConfigSchema,
} from "@bluecadet/launchpad-controller/config";
import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";

export type LaunchpadConfig = {
	/**
	 * The controller configuration.
	 */
	controller?: ControllerConfig;
	/**
	 * Plugins to register with the controller.
	 * Each plugin is a factory that creates a plugin instance.
	 */
	plugins?: PluginConfig[];
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
