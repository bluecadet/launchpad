import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync } from "neverthrow";
import { SchedulerError } from "./errors.js";
import { type SchedulerConfig, schedulerConfigSchema } from "./scheduler-config.js";
import { SchedulerEngine } from "./scheduler-engine.js";

/**
 * Creates a Launchpad Scheduler plugin factory.
 * Use this in your launchpad config's plugins array.
 */
export function scheduler(config: SchedulerConfig) {
	return definePlugin({
		name: "scheduler",
		setup(ctx: PluginContext) {
			const configResult = schedulerConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(
					new SchedulerError("Invalid scheduler configuration", { cause: configResult.error }),
				);
			}

			const engine = new SchedulerEngine(configResult.data, {
				logger: ctx.logger,
				dispatch: ctx.dispatchCommand,
			});
			engine.start();

			return okAsync({
				disconnect(_reason: DisconnectReason) {
					engine.stop();
					return okAsync(undefined);
				},
			});
		},
	});
}
