import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync } from "neverthrow";
import { SchedulerError } from "./errors.js";
import { type SchedulerCommand, schedulerCommandSchema } from "./scheduler-commands.js";
import { type SchedulerConfig, schedulerConfigSchema } from "./scheduler-config.js";
import { SchedulerEngine } from "./scheduler-engine.js";
import { type SchedulerState, SchedulerStateManager } from "./scheduler-state.js";
import { buildSchedulerSection } from "./scheduler-summarize.js";

/**
 * Creates a Launchpad Scheduler plugin factory.
 * Use this in your launchpad config's plugins array.
 */
export function scheduler(config: SchedulerConfig) {
	return definePlugin({
		name: "scheduler",
		manifest: {
			commands: [
				{ id: "scheduler.pause", parser: schedulerCommandSchema },
				{ id: "scheduler.resume", parser: schedulerCommandSchema },
				{ id: "scheduler.trigger", parser: schedulerCommandSchema },
			],
		},
		summarize(state: LaunchpadState): Section | null {
			const schedulerState = state.plugins.scheduler;
			if (!schedulerState) return null;
			const section = buildSchedulerSection(schedulerState);
			return section.rows.length > 0 ? section : null;
		},
		setup(ctx: PluginContext<SchedulerState>) {
			const configResult = schedulerConfigSchema.safeParse(config);
			if (!configResult.success) {
				return errAsync(
					new SchedulerError("Invalid scheduler configuration", { cause: configResult.error }),
				);
			}

			const stateManager = new SchedulerStateManager(ctx.updateState);
			const engine = new SchedulerEngine(
				configResult.data,
				{
					logger: ctx.logger,
					dispatch: ctx.dispatchCommand,
				},
				(state) => stateManager.setJobs(state.jobs),
			);
			engine.start();

			return okAsync({
				executeCommand(command: SchedulerCommand) {
					const parsed = schedulerCommandSchema.safeParse(command);
					if (!parsed.success) {
						return errAsync(new SchedulerError(`Invalid command: ${parsed.error.message}`));
					}

					const validCommand = parsed.data;
					switch (validCommand.type) {
						case "scheduler.pause":
							return engine.pause(validCommand.job);
						case "scheduler.resume":
							return engine.resume(validCommand.job);
						case "scheduler.trigger":
							return engine.trigger(validCommand.job);
						default: {
							validCommand satisfies never;
							return errAsync(new SchedulerError("Unreachable: unknown command type"));
						}
					}
				},
				disconnect(_reason: DisconnectReason) {
					engine.stop();
					return okAsync(undefined);
				},
			});
		},
	});
}
