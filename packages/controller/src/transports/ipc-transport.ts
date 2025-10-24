/**
 * IPC Transport for Unix socket communication.
 * Enables CLI commands to communicate with persistent controller.
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { ResultAsync } from "neverthrow";
import type { LaunchpadEvents } from "../core/event-bus.js";
import type { LaunchpadState } from "../core/state-store.js";
import type { Transport, TransportContext } from "../core/transport.js";
import {
	CommandExecutionError,
	IPCMessageError,
	StateAccessError,
	TransportError,
} from "../errors.js";
import { IPCSerializer } from "../ipc/ipc-serializer.js";

export type IPCTransportOptions = {
	/** Path to the Unix socket file */
	socketPath: string;
};

export type IPCMessage =
	| { type: "query-state"; id: string }
	| { type: "shutdown"; id: string }
	| { type: "execute-command"; id: string; data: unknown };

export type IPCResponse =
	| { id: string; type: "state"; data: LaunchpadState }
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

/**
 * Create an IPC transport
 */
export function createIPCTransport(options: IPCTransportOptions): Transport {
	let server: net.Server | null = null;
	const clients = new Set<net.Socket>();

	return {
		id: "ipc",

		start(ctx: TransportContext): ResultAsync<void, TransportError> {
			const { logger, abortSignal } = ctx;
			const { socketPath } = options;

			const promise = new Promise<void>((resolve, reject) => {
				// Clean up existing socket
				if (fs.existsSync(socketPath)) {
					try {
						fs.unlinkSync(socketPath);
					} catch (e) {
						return reject(
							new TransportError("Failed to clean up existing socket", {
								cause: e instanceof Error ? e : new Error(String(e)),
							}),
						);
					}
				}

				// Ensure directory exists
				try {
					const dir = path.dirname(socketPath);
					if (!fs.existsSync(dir)) {
						fs.mkdirSync(dir, { recursive: true });
					}
				} catch (e) {
					return reject(
						new TransportError("Failed to create socket directory", {
							cause: e instanceof Error ? e : new Error(String(e)),
						}),
					);
				}

				// Create server
				server = net.createServer((socket) => {
					clients.add(socket);
					logger.debug("IPC client connected");

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
								logger.error(`Failed to parse IPC message: ${error.message}`);
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
						logger.debug("IPC client disconnected");
					});

					socket.on("error", (error) => {
						logger.error(`IPC client error: ${error.message}`);
						clients.delete(socket);
					});
				});

				server.on("error", (error) => {
					const err = error instanceof Error ? error : new Error(String(error));
					logger.error(`IPC server error: ${err.message}`);
					reject(new TransportError("Failed to start IPC server", { cause: err }));
				});

				server.listen(socketPath, () => {
					logger.info(`IPC transport listening at ${socketPath}`);

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
								logger.debug(`Failed to write event to IPC client: ${e}`);
							}
						});
					};
					ctx.eventBus.onAny(handleEvent);

					// Cleanup on abort
					abortSignal.addEventListener("abort", () => {
						ctx.eventBus.offAny(handleEvent);
						clients.forEach((client) => client.end());
						server?.close();
						if (fs.existsSync(socketPath)) {
							try {
								fs.unlinkSync(socketPath);
							} catch (e) {
								logger.warn(`Failed to clean up socket: ${e}`);
							}
						}
						logger.info("IPC transport closed");
					});

					resolve();
				});
			});

			return ResultAsync.fromPromise(
				promise,
				(e) =>
					new TransportError("Failed to start IPC transport", {
						cause: e instanceof Error ? e : new Error(String(e)),
					}),
			);
		},

		stop(ctx: TransportContext): ResultAsync<void, TransportError> {
			const { logger } = ctx;
			const { socketPath } = options;

			const promise = new Promise<void>((resolve, reject) => {
				if (!server) {
					return resolve();
				}

				// Close all client connections
				for (const client of clients) {
					client.end();
				}
				clients.clear();

				// Close server
				server.close((err) => {
					if (err) {
						logger.error(`Error closing IPC server: ${err.message}`);
						return reject(
							new TransportError("Failed to close IPC server", {
								cause: err instanceof Error ? err : new Error(String(err)),
							}),
						);
					}

					// Clean up socket file
					if (fs.existsSync(socketPath)) {
						try {
							fs.unlinkSync(socketPath);
						} catch (e) {
							logger.warn(`Failed to clean up socket file: ${e}`);
						}
					}

					logger.debug("IPC transport stopped");
					server = null;
					resolve();
				});
			});

			return ResultAsync.fromPromise(
				promise,
				(e) =>
					new TransportError("Failed to stop IPC transport", {
						cause: e instanceof Error ? e : new Error(String(e)),
					}),
			);
		},
	};
}

/**
 * Handle an IPC message
 */
function handleMessage(message: IPCMessage, socket: net.Socket, ctx: TransportContext): void {
	const { logger, stateStore, commandDispatcher } = ctx;

	switch (message.type) {
		case "query-state": {
			try {
				const state = stateStore.getState();
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
			const resultAsync = commandDispatcher.dispatch(message.data as { type: string });

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
			setTimeout(() => {
				logger.info("Shutting down via IPC command");
				process.exit(0);
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
