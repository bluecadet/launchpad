/**
 * IPC Transport for Unix socket communication.
 * Enables CLI commands to communicate with persistent controller.
 *
 * Phase 2: Minimal implementation for status queries and shutdown.
 * Future: Add event streaming and command forwarding.
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { ResultAsync } from "neverthrow";
import type { Transport, TransportContext } from "../core/transport.js";

export type IPCTransportOptions = {
	/** Path to the Unix socket file */
	socketPath: string;
};

export type IPCMessage =
	| { type: "query-state"; id: string }
	| { type: "shutdown"; id: string }
	| { type: "execute-command"; id: string; data: unknown };
// Future: | { type: 'subscribe'; id: string; patterns: string[] }

export type IPCResponse =
	| { id: string; type: "state"; data: unknown }
	| { id: string; type: "ack" }
	| { id: string; type: "result"; data: unknown }
	| { id: string; type: "error"; message: string };
// Future: | { id: string; type: 'event'; event: string; data: unknown }

/**
 * Create an IPC transport
 */
export function createIPCTransport(options: IPCTransportOptions): Transport {
	let server: net.Server | null = null;
	const clients = new Set<net.Socket>();

	return {
		id: "ipc",

		start(ctx: TransportContext): ResultAsync<void, Error> {
			const { logger, abortSignal } = ctx;
			const { socketPath } = options;

			const promise = new Promise<void>((resolve, reject) => {
				// Clean up existing socket
				if (fs.existsSync(socketPath)) {
					try {
						fs.unlinkSync(socketPath);
					} catch (e) {
						return reject(new Error(`Failed to clean up existing socket: ${e}`));
					}
				}

				// Ensure directory exists
				const dir = path.dirname(socketPath);
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true });
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
								const message = JSON.parse(line) as IPCMessage;
								handleMessage(message, socket, ctx);
							} catch (e) {
								logger.error(`Failed to parse IPC message: ${e}`);
								sendError(socket, "unknown", "Invalid JSON");
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
					logger.error(`IPC server error: ${error.message}`);
					reject(error);
				});

				server.listen(socketPath, () => {
					logger.info(`IPC transport listening at ${socketPath}`);

					// Future: Subscribe to EventBus for event streaming
					// const handleEvent = (event: string, data: unknown) => {
					//   const message = JSON.stringify({ type: 'event', event, data }) + '\n';
					//   clients.forEach(client => {
					//     try {
					//       client.write(message);
					//     } catch (e) {
					//       logger.error(`Failed to write to IPC client: ${e}`);
					//     }
					//   });
					// };
					// eventBus.onAny(handleEvent);

					// Cleanup on abort
					abortSignal.addEventListener("abort", () => {
						// Future: eventBus.offAny(handleEvent);
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
				(e) => new Error(`Failed to start IPC transport: ${e}`),
			);
		},

		stop(ctx: TransportContext): ResultAsync<void, Error> {
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
						return reject(err);
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
				(e) => new Error(`Failed to stop IPC transport: ${e}`),
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
				logger.error(`Failed to get state: ${e}`);
				sendError(socket, message.id, `Failed to get state: ${e}`);
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
					sendError(socket, message.id, error.message);
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
			sendError(socket, "unknown", "Unknown message type");
		}
	}
}

/**
 * Send a response to the client
 */
function sendResponse(socket: net.Socket, response: IPCResponse): void {
	try {
		socket.write(`${JSON.stringify(response)}\n`);
	} catch (_e) {
		// Socket may be closed, ignore
	}
}

/**
 * Send an error response to the client
 */
function sendError(socket: net.Socket, id: string, message: string): void {
	sendResponse(socket, {
		id,
		type: "error",
		message,
	});
}
