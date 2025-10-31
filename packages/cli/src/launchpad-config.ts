import { controllerConfigSchema } from "@bluecadet/launchpad-controller";
import type { LaunchpadConfig } from "@bluecadet/launchpad-utils/types";

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
