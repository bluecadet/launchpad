/**
 * Custom error classes for the Launchpad CLI package.
 * All errors support the `cause` parameter for error chaining.
 */

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
 * Thrown when module import fails.
 */
export class ImportError extends LaunchpadCLIError {
	constructor(message: string, options?: { cause?: Error }) {
		super(message, options);
		this.name = "ImportError";
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
 * Thrown when monitor subsystem encounters an error.
 */
export class MonitorError extends LaunchpadCLIError {
	constructor(message: string, options?: { cause?: Error }) {
		super(message, options);
		this.name = "MonitorError";
	}
}

/**
 * Thrown when the daemon/controller is not running.
 */
export class DaemonNotRunningError extends LaunchpadCLIError {
	constructor(options?: { cause?: Error }) {
		super("Daemon is not running", options);
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
