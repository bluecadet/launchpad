/**
 * IPC Client for communicating with persistent controller.
 * Used by CLI commands like `status` and `stop`.
 */

import net from "node:net";
import type { BaseCommand } from "@bluecadet/launchpad-utils";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import SuperJSON from "superjson";
import { IPCConnectionError, IPCMessageError, IPCTimeoutError } from "../errors.js";
import type { IPCMessage, IPCResponse } from "../transports/ipc-transport.js";

export class IPCClient {
	private _socket: net.Socket | null = null;
	private _buffer = "";
	private _pendingRequests = new Map<
		string,
		{
			resolve: (response: IPCResponse) => void;
			reject: (error: IPCConnectionError | IPCMessageError | IPCTimeoutError) => void;
		}
	>();
	private _nextId = 0;
	private static readonly DEFAULT_TIMEOUT_MS = 5000;

	/**
	 * Connect to the IPC socket
	 */
	connect(socketPath: string): ResultAsync<void, IPCConnectionError> {
		return ResultAsync.fromPromise(
			new Promise<void>((resolve, reject) => {
				this._socket = net.createConnection(socketPath, () => {
					resolve();
				});

				this._socket.on("error", (error) => {
					reject(
						new IPCConnectionError(`Failed to connect to IPC socket at "${socketPath}"`, {
							cause: error instanceof Error ? error : new Error(String(error)),
						}),
					);
				});

				this._socket.on("data", (data) => {
					this._handleData(data);
				});

				this._socket.on("close", () => {
					// Reject all pending requests
					for (const request of this._pendingRequests.values()) {
						request.reject(new IPCConnectionError("Socket closed unexpectedly"));
					}
					this._pendingRequests.clear();
				});
			}),
			(e) =>
				new IPCConnectionError("IPC connection failed", {
					cause: e instanceof Error ? e : new Error(String(e)),
				}),
		);
	}

	/**
	 * Disconnect from the IPC socket
	 */
	disconnect(): void {
		if (this._socket) {
			this._socket.end();
			this._socket = null;
		}
	}

	/**
	 * Query the controller's current state
	 */
	queryState(): ResultAsync<unknown, IPCConnectionError | IPCMessageError> {
		const message: IPCMessage = {
			type: "query-state",
			id: this._generateId(),
		};

		return this._sendMessage(message).andThen((response) => {
			if (response.type === "state") {
				return okAsync(response.data);
			}
			if (response.type === "error") {
				return errAsync(new IPCMessageError("Controller error", { cause: response.error }));
			}
			return errAsync(new IPCMessageError(`Unexpected response type: ${response.type}`));
		});
	}

	/**
	 * Execute a command on the controller
	 */
	executeCommand(command: BaseCommand): ResultAsync<unknown, IPCConnectionError | IPCMessageError> {
		const message: IPCMessage = {
			type: "execute-command",
			id: this._generateId(),
			data: command,
		};

		return this._sendMessage(message).andThen((response) => {
			if (response.type === "result") {
				return okAsync(response.data);
			}
			if (response.type === "error") {
				return errAsync(
					new IPCMessageError(`Error dispatching command: ${command.type}`, {
						cause: response.error,
					}),
				);
			}
			return errAsync(new IPCMessageError(`Unexpected response type: ${response.type}`));
		});
	}

	/**
	 * Send shutdown command to the controller
	 */
	shutdown(): ResultAsync<void, IPCConnectionError | IPCMessageError> {
		const message: IPCMessage = {
			type: "shutdown",
			id: this._generateId(),
		};

		return this._sendMessage(message).andThen((response) => {
			if (response.type === "ack") {
				return okAsync(undefined);
			}
			if (response.type === "error") {
				return errAsync(new IPCMessageError("Shutdown error", { cause: response.error }));
			}
			return errAsync(new IPCMessageError(`Unexpected response type: ${response.type}`));
		});
	}

	/**
	 * Send a message and wait for response
	 */
	private _sendMessage(
		message: IPCMessage,
	): ResultAsync<IPCResponse, IPCConnectionError | IPCMessageError> {
		if (!this._socket) {
			return errAsync(new IPCConnectionError("Not connected to IPC socket"));
		}

		return ResultAsync.fromPromise(
			new Promise<IPCResponse>((resolve, reject) => {
				const timeoutHandle = setTimeout(() => {
					this._pendingRequests.delete(message.id);
					reject(
						new IPCTimeoutError(
							`IPC request timed out after ${IPCClient.DEFAULT_TIMEOUT_MS}ms`,
							IPCClient.DEFAULT_TIMEOUT_MS,
						),
					);
				}, IPCClient.DEFAULT_TIMEOUT_MS);

				this._pendingRequests.set(message.id, {
					resolve: (response) => {
						clearTimeout(timeoutHandle);
						resolve(response);
					},
					reject,
				});

				const data = `${SuperJSON.stringify(message)}\n`;
				this._socket?.write(data, (error) => {
					if (error) {
						clearTimeout(timeoutHandle);
						this._pendingRequests.delete(message.id);
						reject(
							new IPCConnectionError("Failed to send IPC message", {
								cause: error instanceof Error ? error : new Error(String(error)),
							}),
						);
					}
				});
			}),
			(e) =>
				e instanceof IPCConnectionError || e instanceof IPCTimeoutError
					? e
					: new IPCMessageError("Failed to process IPC response", {
							cause: e instanceof Error ? e : new Error(String(e)),
						}),
		);
	}

	/**
	 * Handle incoming data from socket
	 */
	private _handleData(data: Buffer): void {
		this._buffer += data.toString();

		// Process complete messages (newline-delimited JSON)
		const lines = this._buffer.split("\n");
		this._buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;

			try {
				const response = SuperJSON.parse(line) as IPCResponse;
				const request = this._pendingRequests.get(response.id);

				if (request) {
					this._pendingRequests.delete(response.id);
					request.resolve(response);
				}
			} catch (e) {
				// Reject all pending requests with parse error
				// This shouldn't happen with well-formed messages, but we need to handle it
				const error = e instanceof Error ? e : new Error(String(e));
				for (const request of this._pendingRequests.values()) {
					request.reject(
						new IPCMessageError("Failed to parse IPC response", {
							cause: error,
						}),
					);
				}
				this._pendingRequests.clear();
			}
		}
	}

	/**
	 * Generate a unique message ID
	 */
	private _generateId(): string {
		return `msg-${this._nextId++}`;
	}
}
