import { z } from "zod";
import { logConfigSchema } from "./core/file-logger.js";

export type { ControllerMode } from "@bluecadet/launchpad-utils/types";
export { logConfigSchema } from "./core/file-logger.js";

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
		pidFile: z
			.string()
			.default(".launchpad/launchpad.pid")
			.describe("Daemon PID file path. Relative paths resolve from the config file directory."),

		/**
		 * Path for the IPC socket (for persistent mode communication)
		 * Relative paths are resolved relative to the config file directory
		 * @default ".launchpad/launchpad.sock"
		 */
		socketPath: z
			.string()
			.default(".launchpad/launchpad.sock")
			.describe("IPC socket path. Relative paths resolve from the config file directory."),

		/**
		 * File logging configuration
		 */
		logging: logConfigSchema.describe("Controller-owned file logging configuration."),

		// Future: transports array will go here in Phase 2+
	})
	.optional()
	.prefault({});

export type ControllerConfig = z.input<typeof controllerConfigSchema>;
export type ResolvedControllerConfig = z.output<typeof controllerConfigSchema>;
