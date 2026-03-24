import { z } from "zod";
import { logConfigSchema } from "./core/file-logger.js";

/**
 * Controller mode enum
 */
export type ControllerMode = "task" | "persistent";

/**
 * Controller configuration schema
 */
export const controllerConfigSchema = z
	.object({
		/**
		 * Path to store the daemon PID file (for persistent mode)
		 * Relative paths are resolved relative to the config file directory
		 * @default ".launchpad/launchpad.pid"
		 */
		pidFile: z.string().default(".launchpad/launchpad.pid"),

		/**
		 * Path for the IPC socket (for persistent mode communication)
		 * Relative paths are resolved relative to the config file directory
		 * @default ".launchpad/launchpad.sock"
		 */
		socketPath: z.string().default(".launchpad/launchpad.sock"),

		/**
		 * File logging configuration
		 */
		logging: logConfigSchema,

		// Future: transports array will go here in Phase 2+
	})
	.optional()
	.default({});

export type ControllerConfig = z.input<typeof controllerConfigSchema>;
export type ResolvedControllerConfig = z.output<typeof controllerConfigSchema>;
