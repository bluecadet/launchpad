import type { WorkflowMap, WorkflowStep } from "@bluecadet/launchpad-controller";
import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import z from "zod";

const workflowStepSchema = z.custom<WorkflowStep>((value) => {
	if (typeof value === "string") {
		return /^.+\..+$/.test(value);
	}

	if (typeof value !== "object" || value === null) {
		return false;
	}

	return "type" in value && typeof value.type === "string";
});

export const launchpadConfigSchema = z
	.object({
		controller: controllerConfigSchema.prefault({}),
		plugins: z.array(z.custom<PluginConfig>()).prefault([]),
		workflows: z.record(z.string(), z.array(workflowStepSchema).readonly()).prefault({}),
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
