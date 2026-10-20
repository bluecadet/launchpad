import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import { type Duration, durationSchema } from "@bluecadet/launchpad-utils/duration";
import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";

const CRON_FIELD_COUNT = 5;

function isCronExpression(value: string): boolean {
	return value.trim().split(/\s+/).length === CRON_FIELD_COUNT;
}

const cronSchema = z.string().refine(isCronExpression, {
	message: "Cron expressions must have exactly 5 whitespace-separated fields.",
});

/** Overrides for individual exponential backoff settings. */
export interface BackoffOverride {
	/** Initial retry delay. Defaults to 15 seconds. */
	initial?: Duration;
	/** Maximum retry delay. Defaults to five minutes. */
	max?: Duration;
	/** Positive backoff multiplier. Defaults to `2`. */
	factor?: number;
}

/** Retry indefinitely, optionally overriding the backoff. */
export interface RetryForeverConfig {
	/** Retry indefinitely. Defaults to `true`. */
	forever?: true;
	/** Override individual exponential backoff settings. */
	backoff?: BackoffOverride;
}

/** Stop retrying after a fixed number of failed attempts. */
export interface RetryLimitedConfig {
	/** Stop retrying after `maxAttempts` failures. */
	forever: false;
	/** Positive integer limit on failed attempts. */
	maxAttempts: number;
}

const backoffOverrideSchema = configSchema<BackoffOverride>()(
	z
		.object({
			initial: durationSchema
				.optional()
				.describe("Initial retry delay; omitted values use 15 seconds."),
			max: durationSchema
				.optional()
				.describe("Maximum retry delay; omitted values use five minutes."),
			factor: z
				.number()
				.positive()
				.optional()
				.describe("Positive backoff multiplier; omitted values use 2."),
		})
		.strict(),
);

const retryForeverInputSchema = configSchema<RetryForeverConfig>()(
	z
		.object({
			forever: z
				.literal(true)
				.optional()
				.describe("Retry indefinitely (the default retry policy)."),
			backoff: backoffOverrideSchema
				.optional()
				.describe("Override individual exponential backoff settings."),
		})
		.strict(),
);

const retryLimitedInputSchema = configSchema<RetryLimitedConfig>()(
	z
		.object({
			forever: z.literal(false).describe("Stop retrying after maxAttempts failures."),
			maxAttempts: z
				.number()
				.int()
				.positive()
				.describe("Positive integer limit on failed attempts."),
		})
		.strict(),
);

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

const commandOverrideSchema = z
	.custom<BaseCommand>((value) => {
		if (typeof value !== "object" || value === null) return false;
		return "type" in value && typeof value.type === "string";
	})
	.meta({ configDocs: { inputType: "BaseCommand" } });

/** Bare strings are unambiguous: cron expressions always contain whitespace, durations never do. */
function isCronLike(value: string): boolean {
	return /\s/.test(value.trim());
}

/** Options for a single scheduled job. Exactly one of `interval` or `cron` must be set. */
export interface ScheduleObject {
	/** Delay between completed dispatches. Required when `cron` is absent. */
	interval?: Duration;
	/** Five-field wall-clock cron schedule. Required when `interval` is absent. */
	cron?: string;
	/**
	 * Positive random delay on runs and retries. `true` uses up to 10% for intervals/backoff or 60
	 * seconds for cron; `false` disables jitter. Defaults to `true`.
	 */
	jitter?: boolean | Duration;
	/**
	 * Failed dispatch retry policy. Defaults to indefinite retries with a 15-second initial delay,
	 * five-minute cap, and factor 2.
	 */
	retry?: RetryLimitedConfig | RetryForeverConfig;
	/** Command payload override. When omitted, the scheduler dispatches `{ type: <record key> }`. */
	command?: BaseCommand;
	/** Dispatch immediately when the scheduler starts. Defaults to `false`. */
	runOnStart?: boolean;
	/** Whether this job is scheduled and exposed to scheduler commands and status. Defaults to `true`. */
	enabled?: boolean;
}

const scheduleObjectSchema = configSchema<ScheduleObject>()(
	z.object({
		interval: durationSchema
			.optional()
			.describe("Delay between completed dispatches. Required when cron is absent."),
		cron: cronSchema
			.optional()
			.describe("Five-field wall-clock cron schedule. Required when interval is absent."),
		jitter: jitterSchema.describe(
			"Positive random delay on runs and retries. true uses up to 10% for intervals/backoff or 60 seconds for cron; false disables jitter.",
		),
		retry: retrySchema.describe(
			"Failed dispatch retry policy. Omission resolves at runtime to indefinite retries with 15-second initial delay, five-minute cap, and factor 2.",
		),
		command: commandOverrideSchema
			.optional()
			.describe(
				"Command payload override. When omitted, the scheduler dispatches { type: <record key> }.",
			),
		runOnStart: z
			.boolean()
			.default(false)
			.describe("Dispatch immediately when the scheduler starts."),
		enabled: z
			.boolean()
			.default(true)
			.describe("Whether this job is scheduled and exposed to scheduler commands and status."),
	}),
).superRefine((value, ctx) => {
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
export const scheduleSpecSchema = z
	.preprocess(
		(value) =>
			typeof value === "string"
				? isCronLike(value)
					? { cron: value }
					: { interval: value }
				: value,
		scheduleObjectSchema,
	)
	.meta({ configDocs: { inputType: "ScheduleSpec", propertiesFrom: "output" } });

// z.preprocess widens the schema's input type to `unknown` (its first argument accepts
// anything before the inner schema validates), so z.input<typeof scheduleSpecSchema> would
// erase the public-facing "bare string or object" contract. Declare it explicitly instead.
export type ScheduleSpec = string | ScheduleObject;

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
