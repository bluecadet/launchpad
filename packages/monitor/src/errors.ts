/**
 * Custom error classes for the Launchpad Monitor package.
 * All errors support the `cause` parameter for error chaining.
 */

/**
 * Base error class for all monitor-related errors.
 * Extends Error to support the `cause` parameter for error chaining.
 */
export class MonitorError extends Error {
	override readonly cause?: Error;

	constructor(message: string, options?: { cause?: Error }) {
		super(message);
		this.name = "MonitorError";
		this.cause = options?.cause;
	}
}

/**
 * Thrown when no app with the specified name is found.
 */
export class AppNotFoundError extends MonitorError {
	readonly appName: string;

	constructor(appName: string) {
		super(`No app found with the name '${appName}'`);
		this.name = "AppNotFoundError";
		this.appName = appName;
	}
}

/**
 * Thrown when appNames parameter has an invalid type.
 */
export class InvalidAppNamesError extends MonitorError {
	constructor(message = "Invalid appNames argument") {
		super(message);
		this.name = "InvalidAppNamesError";
	}
}

/**
 * Thrown when no process is found for the specified app.
 */
export class ProcessNotFoundError extends MonitorError {
	readonly appName: string;

	constructor(appName: string) {
		super(`No process found for app '${appName}'`);
		this.name = "ProcessNotFoundError";
		this.appName = appName;
	}
}

/**
 * Thrown when Windows API calls fail.
 */
export class WindowsApiError extends MonitorError {
	constructor(options?: { cause?: Error }) {
		super("Failed to apply window settings", options);
		this.name = "WindowsApiError";
	}
}

/**
 * Thrown when PM2 operations fail.
 */
export class PM2Error extends MonitorError {
	constructor(message: string, options?: { cause?: Error }) {
		super(message, options);
		this.name = "PM2Error";
	}
}
