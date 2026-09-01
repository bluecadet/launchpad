import { z } from "zod";
import { logConfigSchema } from "./core/file-logger.js";

export type { ControllerMode } from "@bluecadet/launchpad-utils/types";

/**
 * Identity of the Node this controller runs on.
 *
 * A Node is one launchpad daemon and the machine it manages. The identity is
 * what a remote client uses to tell Nodes apart. Every field is optional;
 * unconfigured, `id` is derived from the machine's short hostname.
 */
export const nodeIdentityConfigSchema = z
	.object({
		/**
		 * Stable identifier for this Node.
		 * @default sanitized short hostname
		 */
		id: z.string().min(1).optional(),

		/**
		 * Human-readable name for this Node.
		 * @default the resolved `id`
		 */
		label: z.string().min(1).optional(),

		/**
		 * Free-form Node role (deployment tag), e.g. "exhibit" or "projection".
		 * Launchpad never interprets it.
		 */
		role: z.string().min(1).optional(),
	})
	.prefault({});

export type ConfiguredNodeIdentity = z.output<typeof nodeIdentityConfigSchema>;

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

		/**
		 * Identity of this Node. Unconfigured, the id is derived from the
		 * machine's short hostname and the label falls back to the id.
		 */
		node: nodeIdentityConfigSchema,

		// Future: transports array will go here in Phase 2+
	})
	.optional()
	.prefault({});

export type ControllerConfig = z.input<typeof controllerConfigSchema>;
export type ResolvedControllerConfig = z.output<typeof controllerConfigSchema>;
