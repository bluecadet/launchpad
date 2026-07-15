/**
 * Scheduler plugin runtime commands.
 * These commands are dispatched via the controller's executeCommand() method.
 */

import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";

/** Stops future ticks for the named job (omit `job` to pause every job). */
export type SchedulerPauseCommand = BaseCommand & {
	type: "scheduler.pause";
	job?: CommandId;
};

/** Re-schedules paused jobs from `now` (omit `job` to resume every job). */
export type SchedulerResumeCommand = BaseCommand & {
	type: "scheduler.resume";
	job?: CommandId;
};

/** Fires a job immediately, re-anchoring its next tick from this dispatch's completion. */
export type SchedulerTriggerCommand = BaseCommand & {
	type: "scheduler.trigger";
	job: CommandId;
};

export type SchedulerCommand =
	| SchedulerPauseCommand
	| SchedulerResumeCommand
	| SchedulerTriggerCommand;

/** A `CommandId`-shaped string (`${string}.${string}`) — same dotted-namespace rule as config keys. */
const jobIdSchema = z.custom<CommandId>(
	(value) => typeof value === "string" && value.includes("."),
	{ message: "Job id must be a dotted command id" },
);

export const schedulerPauseCommandSchema = z
	.object({
		type: z.literal("scheduler.pause"),
		job: jobIdSchema.optional(),
	})
	.strict();

export const schedulerResumeCommandSchema = z
	.object({
		type: z.literal("scheduler.resume"),
		job: jobIdSchema.optional(),
	})
	.strict();

export const schedulerTriggerCommandSchema = z
	.object({
		type: z.literal("scheduler.trigger"),
		job: jobIdSchema,
	})
	.strict();

export const schedulerCommandSchema = z.discriminatedUnion("type", [
	schedulerPauseCommandSchema,
	schedulerResumeCommandSchema,
	schedulerTriggerCommandSchema,
]);
