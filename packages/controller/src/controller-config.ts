import { configSchema } from "@bluecadet/launchpad-utils/config-schema";
import { z } from "zod";
import { type LogConfig, logConfigSchema } from "./core/file-logger.js";

export type { ControllerMode } from "@bluecadet/launchpad-utils/types";
export type { LogConfig, TextLogConfig } from "./core/file-logger.js";
export { logConfigSchema } from "./core/file-logger.js";

/** Controller process and logging settings. */
export interface ControllerConfig {
	/**
	 * Path to store the daemon PID file (for persistent mode).
	 * Relative paths resolve from the config file directory.
	 * @default ".launchpad/launchpad.pid"
	 */
	pidFile?: string;
	/**
	 * Path for the IPC socket (for persistent mode communication).
	 * Relative paths resolve from the config file directory.
	 * @default ".launchpad/launchpad.sock"
	 */
	socketPath?: string;
	/** Controller-owned file logging configuration. */
	logging?: LogConfig;
}

// Keep the imported logging schema named in emitted declarations instead of expanding its types.
type ControllerConfigSchema = z.ZodPrefault<
	z.ZodObject<{
		pidFile: z.ZodDefault<z.ZodString>;
		socketPath: z.ZodDefault<z.ZodString>;
		logging: typeof logConfigSchema;
	}>
>;

/**
 * Controller configuration schema
 */
export const controllerConfigSchema: ControllerConfigSchema = configSchema<ControllerConfig>()(
	z.object({
		pidFile: z
			.string()
			.default(".launchpad/launchpad.pid")
			.describe("Daemon PID file path. Relative paths resolve from the config file directory."),

		socketPath: z
			.string()
			.default(".launchpad/launchpad.sock")
			.describe("IPC socket path. Relative paths resolve from the config file directory."),

		logging: logConfigSchema.describe("Controller-owned file logging configuration."),

		// Future: transports array will go here in Phase 2+
	}),
).prefault({});

export type ResolvedControllerConfig = z.output<typeof controllerConfigSchema>;
