import { type WorkflowMap, workflowStepSchema } from "@bluecadet/launchpad-controller";
import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import z from "zod";

export const launchpadConfigSchema = z
	.object({
		controller: controllerConfigSchema
			.prefault({})
			.describe("Controller process and logging settings."),
		plugins: z
			.array(z.custom<PluginConfig>().meta({ configDocs: { inputType: "PluginConfig" } }))
			.prefault([])
			.describe("Plugins to initialize, in registration order."),
		workflows: z
			.record(z.string(), z.array(workflowStepSchema).readonly())
			.prefault({})
			.describe("Named command sequences, including optional start and stop workflows."),
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
export type LaunchpadWorkflows = WorkflowMap;

/**
 * Type definition for the config object.
 */
export function defineConfig(config: LaunchpadConfig) {
	return config;
}
