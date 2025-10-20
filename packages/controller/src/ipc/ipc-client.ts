/**
 * IPC Client for communicating with persistent controller.
 * Used by CLI commands like `status` and `stop`.
 */

import net from "node:net";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { IPCMessage, IPCResponse } from "../transports/ipc-transport.js";

export class IPCClient {
	private _socket: net.Socket | null = null;
	private _buffer = "";
	private _pendingRequests = new Map<
		string,
		{
			resolve: (response: IPCResponse) => void;
			reject: (error: Error) => void;
		}
	>();
	private _nextId = 0;

	/**
	 * Connect to the IPC socket
	 */
	connect(socketPath: string): ResultAsync<void, Error> {
		return ResultAsync.fromPromise(
			new Promise<void>((resolve, reject) => {
				this._socket = net.createConnection(socketPath, () => {
					resolve();
				});

				this._socket.on("error", (error) => {
					reject(new Error(`Failed to connect to IPC socket: ${error.message}`));
				});

				this._socket.on("data", (data) => {
					this._handleData(data);
				});

				this._socket.on("close", () => {
					// Reject all pending requests
					for (const request of this._pendingRequests.values()) {
						request.reject(new Error("Socket closed"));
					}
					this._pendingRequests.clear();
				});
			}),
			(e) => e as Error,
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
	queryState(): ResultAsync<unknown, Error> {
		const message: IPCMessage = {
			type: "query-state",
			id: this._generateId(),
		};

		return this._sendMessage(message).andThen((response) => {
			if (response.type === "state") {
				return okAsync(response.data);
			}
			if (response.type === "error") {
				return errAsync(new Error(response.message));
			}
			return errAsync(new Error("Unexpected response type"));
		});
	}

	/**
	 * Execute a command on the controller
	 */
	executeCommand(command: unknown): ResultAsync<unknown, Error> {
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
				return errAsync(new Error(response.message));
			}
			return errAsync(new Error("Unexpected response type"));
		});
	}

	/**
	 * Send shutdown command to the controller
	 */
	shutdown(): ResultAsync<void, Error> {
		const message: IPCMessage = {
			type: "shutdown",
			id: this._generateId(),
		};

		return this._sendMessage(message).andThen((response) => {
			if (response.type === "ack") {
				return okAsync(undefined);
			}
			if (response.type === "error") {
				return errAsync(new Error(response.message));
			}
			return errAsync(new Error("Unexpected response type"));
		});
	}

	/**
	 * Send a message and wait for response
	 */
	private _sendMessage(message: IPCMessage): ResultAsync<IPCResponse, Error> {
		if (!this._socket) {
			return errAsync(new Error("Not connected to IPC socket"));
		}

		return ResultAsync.fromPromise(
			new Promise<IPCResponse>((resolve, reject) => {
				this._pendingRequests.set(message.id, { resolve, reject });

				const data = JSON.stringify(message) + "\n";
				this._socket!.write(data, (error) => {
					if (error) {
						this._pendingRequests.delete(message.id);
						reject(new Error(`Failed to send message: ${error.message}`));
					}
				});
			}),
			(e) => e as Error,
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
				const response = JSON.parse(line) as IPCResponse;
				const request = this._pendingRequests.get(response.id);

				if (request) {
					this._pendingRequests.delete(response.id);
					request.resolve(response);
				}
			} catch (e) {
				// Ignore malformed messages
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
