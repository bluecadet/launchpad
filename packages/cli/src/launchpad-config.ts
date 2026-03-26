import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import z from "zod";

export const launchpadConfigSchema = z
	.object({
		controller: controllerConfigSchema.prefault({}),
		plugins: z.array(z.custom<PluginConfig>()).prefault([]),
	})
	.prefault({});

export type LaunchpadConfig = z.input<typeof launchpadConfigSchema>;

/**
 * Applies defaults to the provided launchpad config.
 */
export function resolveLaunchpadConfig(config: LaunchpadConfig) {
	return launchpadConfigSchema.parse(config);
}

export type ResolvedLaunchpadOptions = ReturnType<typeof resolveLaunchpadConfig>;

/**
 * Type definition for the config object.
 */
export function defineConfig(config: LaunchpadConfig) {
	return config;
}
