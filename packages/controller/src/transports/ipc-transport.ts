/**
 * IPC Transport for Unix socket communication.
 * Enables CLI commands to communicate with persistent controller.
 */

import fs from "node:fs";
import net from "node:net";
import { nextTick } from "node:process";
import {
	type DisconnectReason,
	defineSubsystem,
	type SubsystemContext,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type {
	AnyCommand,
	LaunchpadEvents,
	VersionedLaunchpadState,
} from "@bluecadet/launchpad-utils/types";
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
	| { type: "execute-command"; id: string; data: AnyCommand };

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
 * Create an IPC Transport subsystem
 */
export function createIPCTransport(options: IPCTransportOptions) {
	return defineSubsystem({
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

			return safeCreateServer(socketPath).andThen((server) => {
				const clients = new Set<net.Socket>();

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
								const error = e instanceof Error ? e : new Error(String(e));
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
				const unsubscribePatch = ctx.onStatePatch(handlePatch);

				return ok({
					disconnect(_reason: DisconnectReason) {
						ctx.logger.verbose("IPC Transport is shutting down");
						ctx.eventBus.offAny(handleEvent);
						unsubscribePatch();
						clients.forEach((client) => client.destroy());
						clients.clear();
						server.close();
						if (fs.existsSync(socketPath)) {
							try {
								fs.unlinkSync(socketPath);
							} catch (e) {
								ctx.logger.warn(`Failed to clean up socket: ${e}`);
							}
						}
						ctx.logger.info("IPC transport closed");

						return okAsync();
					},
				});
			});
		},
	});
}

/**
 * create a net.Server with neverthrow error handling
 */
function safeCreateServer(path: string): ResultAsync<net.Server, TransportError> {
	return ResultAsync.fromPromise(
		new Promise<net.Server>((resolve, reject) => {
			const server = net.createServer();

			server.on("error", (error) => {
				reject(error);
			});

			server.listen(path, () => {
				resolve(server);
			});
		}),
		(e) => new TransportError("Failed to create IPC server", { cause: e as Error }),
	);
}

/**
 * Handle an IPC message
 */
function handleMessage(message: IPCMessage, socket: net.Socket, ctx: SubsystemContext): void {
	const { logger } = ctx;

	switch (message.type) {
		case "query-state": {
			try {
				const state = ctx.getState();
				sendResponse(socket, {
					id: message.id,
					type: "state",
					data: state,
				});
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e));
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
			const resultAsync = ctx.dispatchCommand(message.data as AnyCommand);

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
							cause: error instanceof Error ? error : new Error(String(error)),
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

			// Exit after sending response (controller's exit handlers will clean up)
			nextTick(() => {
				logger.info("Shutting down via IPC command");
				ctx.dispatchCommand({
					type: "system.shutdown",
				});
			});
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
