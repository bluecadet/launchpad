/**
 * IPC Transport for Unix socket communication.
 * Enables CLI commands to communicate with persistent controller.
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadEvents, VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";
import type { Patch } from "immer";
import { ok, okAsync, ResultAsync } from "neverthrow";
import {
	CommandExecutionError,
	IPCMessageError,
	StateAccessError,
	TransportError,
} from "../errors.js";
import { IPCSerializer } from "../utils/ipc-serializer.js";
import { getOSSocketPath } from "../utils/ipc-utils.js";

export type IPCTransportOptions = {
	/** Path to the Unix socket file */
	socketPath: string;
};

export type IPCMessage =
	| { type: "query-state"; id: string }
	| { type: "shutdown"; id: string }
	| { type: "execute-command"; id: string; data: unknown };

export type IPCResponse =
	| { id: string; type: "state"; data: VersionedLaunchpadState }
	| { id: string; type: "ack" }
	| { id: string; type: "result"; data: unknown }
	| { id: string; type: "error"; error: Error };

export type IPCEvent = {
	[K in keyof LaunchpadEvents]: {
		type: "event";
		name: K;
		data: LaunchpadEvents[K];
	};
}[keyof LaunchpadEvents];

export type IPCBroadcastMessage =
	| IPCEvent
	| { type: "state-patch"; patches: Patch[]; version: number };

/**
 * Create an IPC Transport plugin
 */
export function createIPCTransport(options: IPCTransportOptions) {
	return definePlugin({
		name: "ipc-transport",
		setup(ctx) {
			const socketPath = getOSSocketPath(options.socketPath);

			if (process.platform === "win32" && options.socketPath !== socketPath) {
				// notify user that the socket path has been updated to conform with windows named pipe reqs,
				// as it might not be where they expect it

				ctx.logger.warn(
					`Windows named pipes must be located in ${chalk.grey("\\\\?\\pipe\\")} or ${chalk.grey("\\\\.\\pipe\\")}. `,
				);
				ctx.logger.warn(
					`The configured socketPath has been moved to the ${chalk.grey("\\\\?\\pipe\\")} directory to conform with this requirement.`,
				);
			}

			return safeCreateServer(socketPath, ctx.logger).andThen((server) => {
				const clients = new Set<net.Socket>();
				let isDisconnected = false;

				// maintain client connections
				server.on("connection", (socket) => {
					clients.add(socket);
					ctx.logger.verbose("IPC client connected");

					let buffer = "";

					socket.on("data", (data) => {
						buffer += data.toString();

						// Process complete messages (newline-delimited JSON)
						const lines = buffer.split("\n");
						buffer = lines.pop() || "";

						for (const line of lines) {
							if (!line.trim()) continue;

							try {
								const message = IPCSerializer.deserialize(line) as IPCMessage;
								handleMessage(message, socket, ctx);
							} catch (e) {
								const error = ensureError(e);
								ctx.logger.error(`Failed to parse IPC message: ${error.message}`);
								sendError(
									socket,
									"unknown",
									new IPCMessageError("Invalid JSON in IPC message", { cause: error }),
								);
							}
						}
					});

					socket.on("close", () => {
						clients.delete(socket);
						ctx.logger.verbose("IPC client disconnected");
					});

					socket.on("error", (error) => {
						ctx.logger.error(`IPC client error: ${error.message}`);
						clients.delete(socket);
					});
				});

				// Subscribe to EventBus for event streaming with type-safe handler
				const handleEvent = <K extends keyof LaunchpadEvents>(
					event: K,
					data: LaunchpadEvents[K],
				) => {
					// Fully type-safe: event and data are correlated via the generic
					const message = createIPCEvent(event, data);
					const serialized = `${IPCSerializer.serialize(message)}\n`;
					clients.forEach((client) => {
						try {
							client.write(serialized);
						} catch (e) {
							ctx.logger.verbose(`Failed to write event to IPC client: ${e}`);
						}
					});
				};
				ctx.eventBus.onAny(handleEvent);

				// Subscribe to state patches from the state store
				const handlePatch = (patches: Patch[], version: number) => {
					const message: IPCBroadcastMessage = {
						type: "state-patch",
						patches,
						version,
					};
					const serialized = `${IPCSerializer.serialize(message)}\n`;
					clients.forEach((client) => {
						try {
							client.write(serialized);
						} catch (e) {
							ctx.logger.verbose(`Failed to write state patch to IPC client: ${e}`);
						}
					});
				};
				const unsubscribePatch = ctx.onGlobalStatePatch(handlePatch);

				return ok({
					disconnect(_reason: DisconnectReason) {
						if (isDisconnected) {
							return okAsync(undefined);
						}

						isDisconnected = true;
						ctx.logger.verbose("IPC Transport is shutting down");
						ctx.eventBus.offAny(handleEvent);
						unsubscribePatch();
						clients.forEach((client) => client.end());

						return ResultAsync.fromPromise(
							new Promise<void>((resolve) => {
								server.close(() => {
									cleanupUnixSocketPath(socketPath, ctx.logger);
									ctx.logger.info("IPC transport closed");
									resolve();
								});
							}),
							(error) =>
								new TransportError("Failed to close IPC server", {
									cause: ensureError(error),
								}),
						);
					},
				});
			});
		},
	});
}

/**
 * create a net.Server with neverthrow error handling
 */
function safeCreateServer(
	path: string,
	logger: PluginContext["logger"],
): ResultAsync<net.Server, TransportError> {
	return ResultAsync.fromPromise(
		createServerWithSocketRecovery(path, logger),
		(e) => new TransportError("Failed to create IPC server", { cause: e as Error }),
	);
}

async function createServerWithSocketRecovery(
	socketPath: string,
	logger: PluginContext["logger"],
): Promise<net.Server> {
	ensureUnixSocketDirectory(socketPath);

	try {
		return await listenOnSocketPath(socketPath);
	} catch (error) {
		const normalizedError = ensureError(error);
		if (!(await shouldRecoverFromListenError(socketPath, normalizedError))) {
			throw normalizedError;
		}

		logger.warn(`Removing stale IPC socket at "${socketPath}"`);
		cleanupUnixSocketPath(socketPath, logger);
		return listenOnSocketPath(socketPath);
	}
}

function ensureUnixSocketDirectory(socketPath: string): void {
	if (process.platform === "win32") {
		return;
	}

	fs.mkdirSync(path.dirname(socketPath), { recursive: true });
}

async function shouldRecoverFromListenError(socketPath: string, error: Error): Promise<boolean> {
	if (process.platform === "win32") {
		return false;
	}

	const errorCode = getErrorCode(error);
	if (errorCode !== "EADDRINUSE") {
		return false;
	}

	return !(await canConnectToSocket(socketPath));
}

function listenOnSocketPath(socketPath: string): Promise<net.Server> {
	return new Promise<net.Server>((resolve, reject) => {
		const server = net.createServer();
		const handleError = (error: Error) => {
			server.removeListener("listening", handleListening);
			reject(error);
		};
		const handleListening = () => {
			server.removeListener("error", handleError);
			resolve(server);
		};

		server.once("error", handleError);
		server.once("listening", handleListening);
		server.listen(socketPath);
	});
}

function canConnectToSocket(socketPath: string): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		const socket = net.createConnection(socketPath);

		socket.once("connect", () => {
			socket.end();
			resolve(true);
		});

		socket.once("error", (error) => {
			const errorCode = getErrorCode(error);
			if (errorCode === "ECONNREFUSED" || errorCode === "ENOENT") {
				resolve(false);
				return;
			}
			reject(error);
		});
	});
}

function cleanupUnixSocketPath(socketPath: string, logger: PluginContext["logger"]): void {
	if (process.platform === "win32" || !fs.existsSync(socketPath)) {
		return;
	}

	try {
		fs.unlinkSync(socketPath);
	} catch (error) {
		logger.warn(`Failed to clean up socket: ${ensureError(error).message}`);
	}
}

function getErrorCode(error: Error): string | undefined {
	return (error as NodeJS.ErrnoException).code;
}

/**
 * Handle an IPC message
 */
function handleMessage(message: IPCMessage, socket: net.Socket, ctx: PluginContext): void {
	const { logger } = ctx;

	switch (message.type) {
		case "query-state": {
			try {
				const state = ctx.getGlobalState();
				sendResponse(socket, {
					id: message.id,
					type: "state",
					data: state,
				});
			} catch (e) {
				const error = ensureError(e);
				logger.error(`Failed to get state: ${error.message}`);
				sendError(
					socket,
					message.id,
					new StateAccessError("Failed to get controller state", { cause: error }),
				);
			}
			break;
		}

		case "execute-command": {
			logger.info("Received execute-command via IPC");
			const resultAsync = ctx.dispatchCommand(message.data as { type: string });

			// Use neverthrow's match to handle Result
			resultAsync.match(
				(value) => {
					sendResponse(socket, {
						id: message.id,
						type: "result",
						data: value,
					});
				},
				(error) => {
					logger.error(`Command execution failed: ${error.message}`);
					sendError(
						socket,
						message.id,
						new CommandExecutionError("IPC command execution failed", {
							cause: ensureError(error),
						}),
					);
				},
			);
			break;
		}

		case "shutdown": {
			logger.info("Received shutdown command via IPC");
			sendResponse(socket, {
				id: message.id,
				type: "ack",
			});

			// Signal shutdown via event bus — the host process decides when to exit
			setTimeout(() => {
				logger.info("Shutting down via IPC command");
				ctx.eventBus.emit("system:shutdown", { code: 0 });
			}, 100);
			break;
		}

		default: {
			sendError(socket, "unknown", new IPCMessageError("Unknown message type"));
		}
	}
}

/**
 * Create a type-safe IPC event message
 * Helper function ensures the event name and data are correctly correlated
 */
function createIPCEvent<K extends keyof LaunchpadEvents>(
	name: K,
	data: LaunchpadEvents[K],
): IPCEvent {
	return {
		type: "event",
		name,
		data,
	} as IPCEvent;
}

/**
 * Send a response to the client
 */
function sendResponse(socket: net.Socket, response: IPCResponse): void {
	try {
		socket.write(`${IPCSerializer.serialize(response)}\n`);
	} catch (_e) {
		// Socket may be closed, ignore
	}
}

/**
 * Send an error response to the client
 */
function sendError(socket: net.Socket, id: string, error: Error): void {
	sendResponse(socket, {
		id,
		type: "error",
		error: error,
	});
}
