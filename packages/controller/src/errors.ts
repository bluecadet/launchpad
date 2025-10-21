/**
 * Custom error classes for the Launchpad Controller package.
 * All errors support the `cause` parameter for error chaining.
 */

/**
 * Base error class for all controller-related errors.
 * Extends Error to support the `cause` parameter for error chaining.
 */
export class ControllerError extends Error {
	override readonly cause?: Error;

	constructor(message: string, options?: { cause?: Error }) {
		super(message);
		this.name = "ControllerError";
		this.cause = options?.cause;
	}
}

/**
 * Base class for IPC-related errors.
 */
export class IPCError extends ControllerError {
	constructor(message: string, options?: { cause?: Error }) {
		super(message, options);
		this.name = "IPCError";
	}
}

/**
 * Thrown when IPC socket connection fails.
 */
export class IPCConnectionError extends IPCError {
	constructor(message = "IPC connection failed", options?: { cause?: Error }) {
		super(message, options);
		this.name = "IPCConnectionError";
	}
}

/**
 * Thrown when IPC message parsing or protocol violation occurs.
 */
export class IPCMessageError extends IPCError {
	constructor(message = "IPC message error", options?: { cause?: Error }) {
		super(message, options);
		this.name = "IPCMessageError";
	}
}

/**
 * Thrown when an IPC request times out.
 */
export class IPCTimeoutError extends IPCError {
	readonly timeoutMs: number;

	constructor(message = "IPC request timed out", timeoutMs = 0, options?: { cause?: Error }) {
		super(message, options);
		this.name = "IPCTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Thrown when command execution fails.
 */
export class CommandExecutionError extends ControllerError {
	readonly commandType?: string;

	constructor(
		message = "Command execution failed",
		options?: { cause?: Error; commandType?: string },
	) {
		super(message, options);
		this.name = "CommandExecutionError";
		this.commandType = options?.commandType;
	}
}

/**
 * Thrown when state access or aggregation fails.
 */
export class StateAccessError extends ControllerError {
	constructor(message = "Failed to access state", options?: { cause?: Error }) {
		super(message, options);
		this.name = "StateAccessError";
	}
}

/**
 * Thrown when process operations fail (PM2 interactions).
 */
export class ProcessError extends ControllerError {
	readonly pid?: number;

	constructor(message = "Process error", options?: { cause?: Error; pid?: number }) {
		super(message, options);
		this.name = "ProcessError";
		this.pid = options?.pid;
	}
}

/**
 * Thrown when transport initialization or shutdown fails.
 */
export class TransportError extends ControllerError {
	constructor(message = "Transport error", options?: { cause?: Error }) {
		super(message, options);
		this.name = "TransportError";
	}
}
