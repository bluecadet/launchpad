import { z } from "zod";
import type { ObservabilityDestination, ResourceAttributes } from "./core/destination.js";

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

/** Configuration shape for the destination-based observability mode. */
export interface DestinationObservabilityConfig extends ObservabilityCoreConfig {
	readonly resource?: ResourceAttributes;
	readonly destinations: readonly ObservabilityDestination[];
	readonly metrics?: false | ObservationConfig;
	readonly delivery?: DeliveryConfig;
	readonly transports?: never;
}
