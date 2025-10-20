/**
 * IPC Client for communicating with persistent controller.
 * Used by CLI commands like `status` and `stop`.
 */

import net from "node:net";
import { err, ok, type Result } from "neverthrow";
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
	async connect(socketPath: string): Promise<Result<void, Error>> {
		return new Promise((resolve) => {
			this._socket = net.createConnection(socketPath, () => {
				resolve(ok(undefined));
			});

			this._socket.on("error", (error) => {
				resolve(err(new Error(`Failed to connect to IPC socket: ${error.message}`)));
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
		});
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
	async queryState(): Promise<Result<unknown, Error>> {
		const message: IPCMessage = {
			type: "query-state",
			id: this._generateId(),
		};

		return this._sendMessage(message).then((response) => {
			if (response.type === "state") {
				return ok(response.data);
			}
			if (response.type === "error") {
				return err(new Error(response.message));
			}
			return err(new Error("Unexpected response type"));
		});
	}

	/**
	 * Send shutdown command to the controller
	 */
	async shutdown(): Promise<Result<void, Error>> {
		const message: IPCMessage = {
			type: "shutdown",
			id: this._generateId(),
		};

		return this._sendMessage(message).then((response) => {
			if (response.type === "ack") {
				return ok(undefined);
			}
			if (response.type === "error") {
				return err(new Error(response.message));
			}
			return err(new Error("Unexpected response type"));
		});
	}

	/**
	 * Send a message and wait for response
	 */
	private async _sendMessage(message: IPCMessage): Promise<IPCResponse> {
		if (!this._socket) {
			throw new Error("Not connected to IPC socket");
		}

		return new Promise((resolve, reject) => {
			this._pendingRequests.set(message.id, { resolve, reject });

			const data = JSON.stringify(message) + "\n";
			this._socket!.write(data, (error) => {
				if (error) {
					this._pendingRequests.delete(message.id);
					reject(new Error(`Failed to send message: ${error.message}`));
				}
			});
		});
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
