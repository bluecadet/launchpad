import { z } from "zod";

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
