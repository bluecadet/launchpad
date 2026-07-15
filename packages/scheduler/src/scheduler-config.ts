import { durationSchema } from "@bluecadet/launchpad-utils/duration";
import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";

const CRON_FIELD_COUNT = 5;

function isCronExpression(value: string): boolean {
	return value.trim().split(/\s+/).length === CRON_FIELD_COUNT;
}

const cronSchema = z.string().refine(isCronExpression, {
	message: "Cron expressions must have exactly 5 whitespace-separated fields.",
});

const backoffOverrideSchema = z
	.object({
		initial: durationSchema.optional(),
		max: durationSchema.optional(),
		factor: z.number().positive().optional(),
	})
	.strict();

const retryForeverInputSchema = z
	.object({
		forever: z.literal(true).optional(),
		backoff: backoffOverrideSchema.optional(),
	})
	.strict();

const retryLimitedInputSchema = z
	.object({
		forever: z.literal(false),
		maxAttempts: z.number().int().positive(),
	})
	.strict();

export type ResolvedRetry =
	| { forever: true; backoff: { initial: number; max: number; factor: number } }
	| { forever: false; maxAttempts: number };

export const DEFAULT_BACKOFF = { initial: 15_000, max: 300_000, factor: 2 };

// A discriminated union can't be used here: the discriminator key ("forever") must itself be
// optional/defaultable, but z.discriminatedUnion requires it present in the raw input to pick a
// branch. A plain union (tried in schema order) plus a manual merge sidesteps that.
const retrySchema = z
	.union([retryLimitedInputSchema, retryForeverInputSchema])
	.optional()
	.transform((value): ResolvedRetry => {
		if (value?.forever === false) {
			return { forever: false, maxAttempts: value.maxAttempts };
		}
		return {
			forever: true,
			backoff: { ...DEFAULT_BACKOFF, ...value?.backoff },
		};
	});

const jitterSchema = z.union([z.boolean(), durationSchema]).default(true);

const commandOverrideSchema = z.custom<BaseCommand>((value) => {
	if (typeof value !== "object" || value === null) return false;
	return "type" in value && typeof value.type === "string";
});

/** Bare strings are unambiguous: cron expressions always contain whitespace, durations never do. */
function isCronLike(value: string): boolean {
	return /\s/.test(value.trim());
}

const scheduleObjectSchema = z
	.object({
		interval: durationSchema.optional(),
		cron: cronSchema.optional(),
		jitter: jitterSchema,
		retry: retrySchema,
		command: commandOverrideSchema.optional(),
		runOnStart: z.boolean().default(false),
		enabled: z.boolean().default(true),
	})
	.superRefine((value, ctx) => {
		const hasInterval = value.interval !== undefined;
		const hasCron = value.cron !== undefined;
		if (hasInterval === hasCron) {
			ctx.addIssue({
				code: "custom",
				message: "Exactly one of `interval` or `cron` must be set.",
				path: [hasInterval ? "cron" : "interval"],
			});
		}
	});

/** A schedule spec: a bare duration/cron string, or the full options object. */
export const scheduleSpecSchema = z.preprocess(
	(value) =>
		typeof value === "string" ? (isCronLike(value) ? { cron: value } : { interval: value }) : value,
	scheduleObjectSchema,
);

// z.preprocess widens the schema's input type to `unknown` (its first argument accepts
// anything before the inner schema validates), so z.input<typeof scheduleSpecSchema> would
// erase the public-facing "bare string or object" contract. Declare it explicitly instead.
export type ScheduleSpec = string | z.input<typeof scheduleObjectSchema>;

// `command` is optional on the schema itself (a bare schedule spec doesn't set it), but
// `schedulerConfigSchema`'s transform is the only place that produces a `ResolvedScheduleSpec`
// value, and it always fills `command` in from the config key when absent. Overriding the
// field to required here keeps consumers (`ScheduledJob`, `SchedulerEngine`) from having to
// re-check a case that can't happen.
export type ResolvedScheduleSpec = Omit<z.output<typeof scheduleSpecSchema>, "command"> & {
	command: BaseCommand;
};

/**
 * Command-keyed scheduler config. Each key is a dispatched command id;
 * the value controls when and how it's scheduled.
 */
export const schedulerConfigSchema = z
	.record(z.string(), scheduleSpecSchema)
	.prefault({})
	.transform((record) => {
		const resolved: Record<string, ResolvedScheduleSpec> = {};
		for (const [commandType, spec] of Object.entries(record)) {
			resolved[commandType] = { ...spec, command: spec.command ?? { type: commandType } };
		}
		return resolved;
	});

// Hand-typed rather than z.input/z.output of schedulerConfigSchema: z.record's key schema can
// only produce `string`, not the branded CommandId template-literal type.
export type SchedulerConfig = Partial<Record<CommandId, ScheduleSpec>>;
export type ResolvedSchedulerConfig = Partial<Record<CommandId, ResolvedScheduleSpec>>;

/**
 * Applies defaults to the provided scheduler config.
 */
export function resolveSchedulerConfig(config: SchedulerConfig): ResolvedSchedulerConfig {
	return schedulerConfigSchema.parse(config);
}

/**
 * Type definition helper for the scheduler config object.
 */
export function defineSchedulerConfig(config: SchedulerConfig) {
	return config;
}
