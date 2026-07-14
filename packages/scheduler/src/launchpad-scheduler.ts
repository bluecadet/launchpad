import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync } from "neverthrow";
import { SchedulerError } from "./errors.js";
import { type SchedulerConfig, schedulerConfigSchema } from "./scheduler-config.js";

/**
 * Creates a Launchpad Scheduler plugin factory.
 * Use this in your launchpad config's plugins array.
 */
export function scheduler(config: SchedulerConfig) {
	return definePlugin({
		name: "scheduler",
		setup(_ctx: PluginContext) {
			const configResult = schedulerConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(
					new SchedulerError("Invalid scheduler configuration", { cause: configResult.error }),
				);
			}

			return okAsync({});
		},
	});
}
