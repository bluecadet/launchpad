import { z } from "zod";

/**
 * Controller mode enum
 */
export type ControllerMode = "task" | "persistent";

/**
 * Controller configuration schema
 * In Phase 1, this is minimal. Phase 2 will add transport configuration.
 */
export const controllerConfigSchema = z
	.object({
		// Future: transports array will go here in Phase 2
	})
	.optional()
	.default({});

export type ControllerConfig = z.infer<typeof controllerConfigSchema>;
