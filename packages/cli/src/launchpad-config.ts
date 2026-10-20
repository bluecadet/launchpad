import { type WorkflowMap, workflowStepSchema } from "@bluecadet/launchpad-controller";
import {
	type ControllerConfig,
	controllerConfigSchema,
} from "@bluecadet/launchpad-controller/config";
import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import z from "zod";

/** Launchpad config: controller settings, plugins, and named workflows. */
export interface LaunchpadConfig {
	/** Controller process and logging settings. */
	controller?: ControllerConfig;
	/** Plugins to initialize, in registration order. */
	plugins?: PluginConfig[];
	/** Named command sequences, including optional start and stop workflows. */
	workflows?: Record<string, readonly z.input<typeof workflowStepSchema>[]>;
}

export const launchpadConfigSchema = configSchema<LaunchpadConfig>()(
	z.object({
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
	}),
).prefault({});

/**
 * Applies defaults to the provided launchpad config.
 */
export function resolveLaunchpadConfig(config: LaunchpadConfig): ResolvedLaunchpadOptions {
	return launchpadConfigSchema.parse(config);
}

export type ResolvedLaunchpadOptions = z.output<typeof launchpadConfigSchema>;
export type LaunchpadWorkflows = WorkflowMap;

/**
 * Type definition for the config object.
 */
export function defineConfig(config: LaunchpadConfig): LaunchpadConfig {
	return config;
}
