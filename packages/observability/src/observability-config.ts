import { z } from "zod";
import type { ObservabilityDestination, ResourceAttributes } from "./core/destination.js";
import type { ObservabilityTransport } from "./core/transport.js";

export const observabilityCoreConfigSchema = z.object({
	/**
	 * Event name patterns to include. Supports * wildcards.
	 * Defaults to log events only. Add patterns like "command:*" or "monitor:*" to include lifecycle events.
	 */
	include: z
		.array(z.string())
		.default(["log:*"])
		.describe("Event name patterns to include. Supports * wildcards."),
	/**
	 * Event name patterns to exclude. Takes precedence over include patterns.
	 */
	exclude: z
		.array(z.string())
		.default([])
		.describe("Event name patterns to exclude. Takes precedence over include."),
	/**
	 * Batching configuration.
	 */
	batch: z
		.object({
			/** Flush interval in milliseconds. Default: 1000. */
			intervalMs: z.number().default(1000),
			/** Maximum entries per batch before a forced flush. Default: 100. */
			maxEntries: z.number().default(100),
		})
		.default({ intervalMs: 1000, maxEntries: 100 }),
	/**
	 * Retry buffer configuration.
	 */
	buffer: z
		.object({
			/** Maximum number of failed batches to keep in memory. Default: 50. */
			maxBatches: z.number().default(50),
			/** Maximum number of retry attempts per batch. Default: 3. */
			maxRetries: z.number().default(3),
		})
		.default({ maxBatches: 50, maxRetries: 3 }),
});

export type ObservabilityCoreConfig = z.input<typeof observabilityCoreConfigSchema>;
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
export const resourceAttributesSchema: z.ZodType<ResourceAttributes> = z
	.unknown()
	.superRefine((resource, context) => {
		if (typeof resource === "object" && resource !== null && Object.hasOwn(resource, "__proto__")) {
			context.addIssue({
				code: "custom",
				message: 'Resource attribute "__proto__" is not supported',
				path: ["__proto__"],
			});
		}
	})
	.pipe(resourceAttributesRecordSchema);

/** Gauge observation cadence. */
export const observationConfigSchema = z.object({
	intervalMs: z.number().int().positive().max(MAX_TIMER_MS).default(30_000),
});

export type ObservationConfig = z.input<typeof observationConfigSchema>;
export type ResolvedObservationConfig = z.output<typeof observationConfigSchema>;

/** Bounded destination delivery and shutdown behavior. */
export const deliveryConfigSchema = z.object({
	deliveryTimeoutMs: z.number().int().positive().max(MAX_TIMER_MS).default(5_000),
	shutdownTimeoutMs: z.number().int().positive().max(MAX_TIMER_MS).default(3_000),
	maxQueuedBatches: z.number().int().positive().max(10_000).default(50),
});

export type DeliveryConfig = z.input<typeof deliveryConfigSchema>;
export type ResolvedDeliveryConfig = z.output<typeof deliveryConfigSchema>;

/** Selects the controller-owned canonical log as the durable delivery source. */
export const logStorageConfigSchema = z.object({ type: z.literal("file") }).strict();

export type LogStorageConfig = z.input<typeof logStorageConfigSchema>;
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
	});

const transportsSchema = z.custom<ObservabilityTransport[]>((value) => Array.isArray(value), {
	error: "Observability transports must be an array",
});

function forbiddenConfigField(message: string) {
	return z.custom<never>(() => false, { error: message }).optional();
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

/** Configuration schema for the legacy transport-based observability mode. */
export const legacyObservabilityConfigSchema = removedDeploymentGuardSchema.and(
	observabilityCoreConfigSchema.extend({
		transports: transportsSchema,
		resource: forbiddenConfigField(
			"Observability resource attributes require destination-based configuration",
		),
		destinations: forbiddenConfigField(
			"Observability destinations and transports cannot be combined",
		),
		metrics: forbiddenConfigField("Observability metrics require destination-based configuration"),
		delivery: forbiddenConfigField(
			"Observability delivery requires destination-based configuration",
		),
		logStorage: forbiddenConfigField(
			"Observability file log storage is only supported with destinations",
		),
	}),
);

/** Configuration schema for the destination-based observability mode. */
export const destinationObservabilityConfigSchema = removedDeploymentGuardSchema.and(
	observabilityCoreConfigSchema.extend({
		resource: resourceAttributesSchema.prefault({}),
		destinations: observabilityDestinationsSchema,
		metrics: z.union([z.literal(false), observationConfigSchema]).prefault({}),
		delivery: deliveryConfigSchema.prefault({}),
		logStorage: logStorageConfigSchema.optional().transform((storage) => storage ?? false),
		transports: forbiddenConfigField(
			"Observability destinations and transports cannot be combined",
		),
	}),
);

/** Complete observability configuration schema for both supported modes. */
export const observabilityConfigSchema = z.union([
	destinationObservabilityConfigSchema,
	legacyObservabilityConfigSchema,
]);

export type LegacyObservabilityConfig = z.input<typeof legacyObservabilityConfigSchema>;
export type ResolvedLegacyObservabilityConfig = z.output<typeof legacyObservabilityConfigSchema>;
export type DestinationObservabilityConfig = z.input<typeof destinationObservabilityConfigSchema>;
export type ResolvedDestinationObservabilityConfig = z.output<
	typeof destinationObservabilityConfigSchema
>;
export type ObservabilityConfig = z.input<typeof observabilityConfigSchema>;
export type ResolvedObservabilityConfig = z.output<typeof observabilityConfigSchema>;
