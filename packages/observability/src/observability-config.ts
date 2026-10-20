import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import { z } from "zod";
import type { ObservabilityDestination, ResourceAttributes } from "./core/destination.js";
import type { ObservabilityTransport } from "./core/transport.js";

/** Log batching settings. */
export interface ObservabilityBatchConfig {
	/** Flush interval in milliseconds. Defaults to `1000`. */
	intervalMs?: number;
	/** Maximum entries per batch before a forced flush. Defaults to `100`. */
	maxEntries?: number;
}

/** Log retry buffer settings. */
export interface ObservabilityBufferConfig {
	/** Maximum number of failed batches to keep in memory. Defaults to `50`. */
	maxBatches?: number;
	/** Maximum number of retry attempts per batch. Defaults to `3`. */
	maxRetries?: number;
}

/** Settings shared by every observability mode. */
export interface ObservabilityCoreConfig {
	/**
	 * Event name patterns to include. Supports * wildcards.
	 * Defaults to log events only (`["log:*"]`). Add patterns like "command:*" or "monitor:*" to include lifecycle events.
	 */
	include?: string[];
	/**
	 * Event name patterns to exclude. Takes precedence over include patterns.
	 * Defaults to `[]`.
	 */
	exclude?: string[];
	/** Batching configuration. */
	batch?: ObservabilityBatchConfig;
	/** Retry buffer configuration. */
	buffer?: ObservabilityBufferConfig;
}

const observabilityBatchConfigSchema = configSchema<ObservabilityBatchConfig>()(
	z.object({
		intervalMs: z
			.number()
			.default(1000)
			.describe("Maximum wait in milliseconds before flushing a log batch."),
		maxEntries: z.number().default(100).describe("Log entries that force a batch flush."),
	}),
);

const observabilityBufferConfigSchema = configSchema<ObservabilityBufferConfig>()(
	z.object({
		maxBatches: z.number().default(50).describe("Failed-log batch limit in legacy transport mode."),
		maxRetries: z
			.number()
			.default(3)
			.describe(
				"Log retry limit in memory delivery and retry attempt limit per file-backed batch.",
			),
	}),
);

export const observabilityCoreConfigSchema = configSchema<ObservabilityCoreConfig>()(
	z.object({
		include: z
			.array(z.string())
			.default(["log:*"])
			.describe(
				"Event-name patterns to export as logs. Supports * wildcards; an empty array includes all available events.",
			),
		exclude: z
			.array(z.string())
			.default([])
			.describe("Event name patterns to exclude. Takes precedence over include."),
		batch: observabilityBatchConfigSchema
			.default({ intervalMs: 1000, maxEntries: 100 })
			.describe("Log batching settings."),
		buffer: observabilityBufferConfigSchema
			.default({ maxBatches: 50, maxRetries: 3 })
			.describe("Log retry buffer settings."),
	}),
);

export type ResolvedObservabilityCoreConfig = z.output<typeof observabilityCoreConfigSchema>;

const MAX_TIMER_MS = 2_147_483_647;
const MAX_RESOURCE_ATTRIBUTES = 64;
const MAX_RESOURCE_ATTRIBUTE_KEY_LENGTH = 128;
const MAX_RESOURCE_ATTRIBUTE_STRING_LENGTH = 1_024;

const resourceAttributeKeySchema = z
	.string()
	.max(MAX_RESOURCE_ATTRIBUTE_KEY_LENGTH)
	.refine((key) => key.trim().length > 0, "Resource attribute keys must not be blank");
const resourceAttributeValueSchema = z.union([
	z.string().max(MAX_RESOURCE_ATTRIBUTE_STRING_LENGTH),
	z.number().finite(),
	z.boolean(),
]);

const resourceAttributesRecordSchema = z
	.record(resourceAttributeKeySchema, resourceAttributeValueSchema)
	.superRefine((attributes, context) => {
		if (Object.keys(attributes).length > MAX_RESOURCE_ATTRIBUTES) {
			context.addIssue({
				code: "custom",
				message: `Resource attributes cannot contain more than ${MAX_RESOURCE_ATTRIBUTES} entries`,
			});
		}

		if (Object.hasOwn(attributes, "service.instance.id")) {
			context.addIssue({
				code: "custom",
				message: 'Resource attribute "service.instance.id" is managed by the runtime',
				path: ["service.instance.id"],
			});
		}

		const serviceName = attributes["service.name"];
		if (
			serviceName !== undefined &&
			(typeof serviceName !== "string" || serviceName.trim() === "")
		) {
			context.addIssue({
				code: "custom",
				message: 'Resource attribute "service.name" must be a nonblank string',
				path: ["service.name"],
			});
		}
	});

/** Bounded primitive attributes attached to every signal from one setup. */
export const resourceAttributesSchema: z.ZodType<ResourceAttributes, ResourceAttributes> = z
	.custom<ResourceAttributes>()
	.superRefine((resource, context) => {
		if (typeof resource === "object" && resource !== null && Object.hasOwn(resource, "__proto__")) {
			context.addIssue({
				code: "custom",
				message: 'Resource attribute "__proto__" is not supported',
				path: ["__proto__"],
			});
		}
	})
	.pipe(resourceAttributesRecordSchema)
	.meta({ configDocs: { inputType: "ResourceAttributes", propertiesFrom: "output" } });

/** Gauge observation cadence. */
export interface ObservationConfig {
	/** Gauge observation interval in milliseconds. Defaults to `30000`. */
	intervalMs?: number;
}

export const observationConfigSchema = configSchema<ObservationConfig>()(
	z.object({
		intervalMs: z
			.number()
			.int()
			.positive()
			.max(MAX_TIMER_MS)
			.default(30_000)
			.describe("Gauge observation interval in milliseconds."),
	}),
);

export type ResolvedObservationConfig = z.output<typeof observationConfigSchema>;

/** Bounded destination delivery and shutdown behavior. */
export interface DeliveryConfig {
	/** Deadline in milliseconds for one destination export request. Defaults to `5000`. */
	deliveryTimeoutMs?: number;
	/** Deadline in milliseconds for queue flushes and destination shutdown work. Defaults to `3000`. */
	shutdownTimeoutMs?: number;
	/** Maximum queued batches held in each in-memory signal queue. Defaults to `50`. */
	maxQueuedBatches?: number;
}

export const deliveryConfigSchema = configSchema<DeliveryConfig>()(
	z.object({
		deliveryTimeoutMs: z
			.number()
			.int()
			.positive()
			.max(MAX_TIMER_MS)
			.default(5_000)
			.describe("Deadline in milliseconds for one destination export request."),
		shutdownTimeoutMs: z
			.number()
			.int()
			.positive()
			.max(MAX_TIMER_MS)
			.default(3_000)
			.describe("Deadline in milliseconds for queue flushes and destination shutdown work."),
		maxQueuedBatches: z
			.number()
			.int()
			.positive()
			.max(10_000)
			.default(50)
			.describe("Maximum queued batches held in each in-memory signal queue."),
	}),
);

export type ResolvedDeliveryConfig = z.output<typeof deliveryConfigSchema>;

/** Log delivery backed by the controller-owned canonical log file. */
export interface FileLogStorageConfig {
	type: "file";
}

/** Log delivery that captures live events only. */
export interface MemoryLogStorageConfig {
	type: "memory";
}

/** File delivery uses the controller-owned canonical log; memory captures live events only. */
export type LogStorageConfig = FileLogStorageConfig | MemoryLogStorageConfig;

export const logStorageConfigSchema = configSchema<LogStorageConfig>()(
	z.discriminatedUnion("type", [
		z.object({ type: z.literal("file") }).strict(),
		z.object({ type: z.literal("memory") }).strict(),
	]),
);

export type ResolvedLogStorageConfig = z.output<typeof logStorageConfigSchema>;

const destinationSchema = z.custom<ObservabilityDestination>(
	(value) =>
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof value.name === "string" &&
		"create" in value &&
		typeof value.create === "function",
	{ error: "Each observability destination must have a string name and create function" },
);

/**
 * Destination factories are capabilities, not data. Validate their surface while
 * preserving the original objects so method-style factories retain their `this` value.
 */
export const observabilityDestinationsSchema = z
	.custom<readonly ObservabilityDestination[]>((value) => Array.isArray(value), {
		error: "Observability destinations must be an array",
	})
	.superRefine((destinations, context) => {
		if (destinations.length === 0) {
			context.addIssue({
				code: "custom",
				message: "Observability destinations must be a non-empty array",
			});
		}

		const names = new Set<string>();
		for (const [index, destination] of destinations.entries()) {
			const parsedDestination = destinationSchema.safeParse(destination);
			if (!parsedDestination.success) {
				context.addIssue({
					code: "custom",
					message: parsedDestination.error.issues[0]?.message ?? "Invalid destination",
					path: [index],
				});
				continue;
			}

			const normalizedName = destination.name.trim();
			if (normalizedName.length === 0) {
				context.addIssue({
					code: "custom",
					message: "Observability destination names must not be blank",
					path: [index, "name"],
				});
				continue;
			}
			if (normalizedName === "__proto__") {
				context.addIssue({
					code: "custom",
					message: 'Observability destination name "__proto__" is not supported',
					path: [index, "name"],
				});
				continue;
			}
			if (names.has(normalizedName)) {
				context.addIssue({
					code: "custom",
					message: `Duplicate observability destination name: "${normalizedName}"`,
					path: [index, "name"],
				});
				continue;
			}
			names.add(normalizedName);
		}
	})
	.describe(
		"Nonempty list of destination factories with nonblank, unique names; __proto__ is reserved.",
	)
	.meta({ configDocs: { inputType: "readonly ObservabilityDestination[]" } });

const transportsSchema = z
	.custom<ObservabilityTransport[]>((value) => Array.isArray(value), {
		error: "Observability transports must be an array",
	})
	.describe("Legacy logs-only transports using in-memory delivery.")
	.meta({ configDocs: { inputType: "ObservabilityTransport[]" } });

function forbiddenConfigField(message: string) {
	return z
		.custom<never>(() => false, { error: message })
		.optional()
		.describe(message)
		.meta({ configDocs: { inputType: "never" } });
}

const removedDeploymentGuardSchema = z
	.unknown()
	.superRefine((config, context) => {
		if (typeof config === "object" && config !== null && Object.hasOwn(config, "deployment")) {
			context.addIssue({
				code: "custom",
				message:
					"Observability deployment configuration was removed; use resource attributes instead",
				path: ["deployment"],
			});
		}
	})
	.transform(() => ({}));

/** Configuration for the legacy transport-based observability mode. */
export interface LegacyObservabilityConfig extends ObservabilityCoreConfig {
	/** Legacy logs-only transports using in-memory delivery. */
	transports: ObservabilityTransport[];
	/** Not supported with transports; use destination-based configuration. */
	resource?: never;
	/** Destinations and transports cannot be combined. */
	destinations?: never;
	/** Not supported with transports; use destination-based configuration. */
	metrics?: never;
	/** Not supported with transports; use destination-based configuration. */
	delivery?: never;
	/** Only supported with destinations. */
	logStorage?: never;
}

/** Configuration schema for the legacy transport-based observability mode. */
export const legacyObservabilityConfigSchema = configSchema<LegacyObservabilityConfig>()(
	removedDeploymentGuardSchema.and(
		observabilityCoreConfigSchema.extend({
			transports: transportsSchema,
			resource: forbiddenConfigField(
				"Observability resource attributes require destination-based configuration",
			),
			destinations: forbiddenConfigField(
				"Observability destinations and transports cannot be combined",
			),
			metrics: forbiddenConfigField(
				"Observability metrics require destination-based configuration",
			),
			delivery: forbiddenConfigField(
				"Observability delivery requires destination-based configuration",
			),
			logStorage: forbiddenConfigField(
				"Observability log storage configuration is only supported with destinations",
			),
		}),
	),
);

/** Configuration for the destination-based observability mode. */
export interface DestinationObservabilityConfig extends ObservabilityCoreConfig {
	/**
	 * Flat primitive attributes attached to every log and metric. Runtime supplies service.name
	 * and service.instance.id; the latter cannot be configured.
	 * Defaults to `{}`.
	 */
	resource?: ResourceAttributes;
	/** Nonempty list of destination factories with nonblank, unique names. */
	destinations: readonly ObservabilityDestination[];
	/** Gauge collection settings; `false` disables metrics. Defaults to `{}`. */
	metrics?: false | ObservationConfig;
	/** Bounded destination delivery and shutdown behavior. Defaults to `{}`. */
	delivery?: DeliveryConfig;
	/** Log delivery source. Defaults to file-backed delivery (`{ type: "file" }`); select memory for live-only queues. */
	logStorage?: LogStorageConfig;
	/** Destinations and transports cannot be combined. */
	transports?: never;
}

/** Configuration schema for the destination-based observability mode. */
export const destinationObservabilityConfigSchema = configSchema<DestinationObservabilityConfig>()(
	removedDeploymentGuardSchema.and(
		observabilityCoreConfigSchema.extend({
			resource: resourceAttributesSchema
				.prefault({})
				.describe(
					"Flat primitive attributes attached to every log and metric. Runtime supplies service.name and service.instance.id; the latter cannot be configured.",
				),
			destinations: observabilityDestinationsSchema,
			metrics: z
				.union([z.literal(false), observationConfigSchema])
				.prefault({})
				.describe("Gauge collection settings; false disables metrics."),
			delivery: deliveryConfigSchema
				.prefault({})
				.describe("Bounded destination delivery and shutdown behavior."),
			logStorage: logStorageConfigSchema
				.prefault({ type: "file" })
				.describe(
					"Log delivery source: retained controller-owned file replay or live-only in-memory batching.",
				),
			transports: forbiddenConfigField(
				"Observability destinations and transports cannot be combined",
			),
		}),
	),
);

/** Complete observability configuration for both supported modes. */
export type ObservabilityConfig = DestinationObservabilityConfig | LegacyObservabilityConfig;

/** Complete observability configuration schema for both supported modes. */
export const observabilityConfigSchema = configSchema<ObservabilityConfig>()(
	z.union([destinationObservabilityConfigSchema, legacyObservabilityConfigSchema]),
);

export type ResolvedLegacyObservabilityConfig = z.output<typeof legacyObservabilityConfigSchema>;
export type ResolvedDestinationObservabilityConfig = z.output<
	typeof destinationObservabilityConfigSchema
>;
export type ResolvedObservabilityConfig = z.output<typeof observabilityConfigSchema>;
