/**
 * Custom error classes for the Launchpad Controller package.
 * All errors support the `cause` parameter for error chaining.
 */

import type {
	CommandDispatchError,
	CommandFailureReason,
} from "@bluecadet/launchpad-utils/plugin-interfaces";

/**
 * Base error class for all controller-related errors.
 * Extends Error to support the `cause` parameter for error chaining.
 */
class ControllerError extends Error {
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
class IPCError extends ControllerError {
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
 * Thrown when dispatching a command fails.
 *
 * `reason` is the discriminant every transport maps to its own vocabulary — an
 * HTTP status code, a JSON-RPC error code — so nothing downstream has to match
 * on the message text.
 */
export class CommandExecutionError extends ControllerError implements CommandDispatchError {
	readonly reason: CommandFailureReason;
	readonly commandType?: string;

	constructor(
		message: string,
		options: { reason: CommandFailureReason; cause?: Error; commandType?: string },
	) {
		super(message, options);
		this.name = "CommandExecutionError";
		this.reason = options.reason;
		this.commandType = options.commandType;
	}
}

/**
 * Thrown when a plugin's manifest cannot be added to the command registry —
 * a duplicate command id, or an alias that collides with something already
 * registered. This is a startup failure, not a dispatch failure: it never
 * reaches a client, so it carries no `CommandFailureReason`.
 */
export class CommandRegistrationError extends ControllerError {
	readonly commandType: string;

	constructor(message: string, options: { commandType: string; cause?: Error }) {
		super(message, options);
		this.name = "CommandRegistrationError";
		this.commandType = options.commandType;
	}
}

/**
 * Thrown when a workflow cannot be run: an unknown name, a name already in
 * flight, or a run that failed. Carries a message only — a workflow step's
 * params and return values never reach a client.
 */
export class WorkflowError extends ControllerError {
	constructor(message = "Workflow error", options?: { cause?: Error }) {
		super(message, options);
		this.name = "WorkflowError";
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

/**
 * JSON-RPC 2.0 error codes
 */
export const JSONRPC_ERROR_CODES = {
	PARSE_ERROR: -32700,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	SERVER_ERROR: -32000,
} as const;

function commandFailureCode(reason: CommandFailureReason): number {
	switch (reason) {
		case "not-registered":
			return JSONRPC_ERROR_CODES.METHOD_NOT_FOUND;
		case "invalid":
			return JSONRPC_ERROR_CODES.INVALID_PARAMS;
		default:
			return JSONRPC_ERROR_CODES.INTERNAL_ERROR;
	}
}

function jsonrpcCode(err: Error): number {
	if (err instanceof IPCMessageError) {
		return JSONRPC_ERROR_CODES.PARSE_ERROR;
	}
	if (err instanceof CommandExecutionError) {
		return commandFailureCode(err.reason);
	}
	return JSONRPC_ERROR_CODES.INTERNAL_ERROR;
}

/**
 * Convert a controller error to a JSON-RPC 2.0 error object.
 * Maps known error types to appropriate standard codes.
 */
export function toJSONRPCError(err: Error): { code: number; message: string; data: Error } {
	return { code: jsonrpcCode(err), message: err.message, data: err };
}
