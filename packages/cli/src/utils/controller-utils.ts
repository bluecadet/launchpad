/**
 * Utilities for controller integration in CLI commands.
 * Phase 1: Task mode - Controller is created per-command and disposed after execution.
 */

import { LaunchpadController } from "@bluecadet/launchpad-controller";
import type { BaseCommand, Logger, Subsystem } from "@bluecadet/launchpad-utils";
import type { ResultAsync } from "neverthrow";

/**
 * Execute a command through the controller in task mode.
 * This creates a controller, registers the subsystem, executes the command, and stops the controller.
 *
 * @param subsystemName - Name of the subsystem (e.g., 'content', 'monitor')
 * @param subsystemInstance - Instance of the subsystem
 * @param command - Command to execute
 * @param logger - Logger instance
 * @returns Result of command execution
 */
export function executeViaController(
	subsystemName: string,
	subsystemInstance: Subsystem,
	command: BaseCommand,
	logger: Logger,
): ResultAsync<unknown, Error> {
	// Create controller in task mode
	const controller = new LaunchpadController({}, logger, "task");

	// Register subsystem
	controller.registerSubsystem(subsystemName, subsystemInstance);

	// Start controller, execute command, then stop
	return controller
		.start()
		.andThen(() => controller.executeCommand(command))
		.andThen((result) => controller.stop().map(() => result));
}
