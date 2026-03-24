import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";

/**
 * System commands (controller-owned).
 * Plugins define their own command types in their respective packages.
 */
export type SystemCommand = {
	type: "system.shutdown";
	code?: number;
};

/**
 * Generic command type for the controller.
 * This is a union of all possible commands, but the controller treats them generically.
 * Type safety is enforced at the plugin level.
 */
export type Command = BaseCommand;

/**
 * Extract the command type string from a Command
 */
export type CommandType = Command["type"];
