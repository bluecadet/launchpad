/**
 * Custom error classes for the Launchpad CLI package.
 * All errors support the `cause` parameter for error chaining.
 */

import chalk from "chalk";

/**
 * Base error class for all CLI-related errors.
 */
class LaunchpadCLIError extends Error {
	override readonly cause?: Error;

	constructor(message: string, options?: { cause?: Error }) {
		super(message);
		this.name = "LaunchpadCLIError";
		this.cause = options?.cause;
	}
}

/**
 * Thrown when configuration file loading or validation fails.
 */
export class ConfigError extends LaunchpadCLIError {
	constructor(message: string, options?: { cause?: Error }) {
		super(message, options);
		this.name = "ConfigError";
	}
}

/**
 * Thrown when the daemon/controller is not running.
 */
export class DaemonNotRunningError extends LaunchpadCLIError {
	constructor(options?: { cause?: Error }) {
		super(
			`Launchpad controller is not running. Start it with: ${chalk.blue("launchpad start")}`,
			options,
		);
		this.name = "DaemonNotRunningError";
	}
}

/**
 * Thrown when IPC communication with the controller fails.
 */
export class IPCConnectionError extends LaunchpadCLIError {
	constructor(message: string, options?: { cause?: Error }) {
		super(message, options);
		this.name = "IPCConnectionError";
	}
}
