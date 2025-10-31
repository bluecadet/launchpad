/**
 * IPC Client for communicating with persistent controller.
 * Used by CLI commands like `status` and `stop`.
 */

import net from "node:net";
import type { BaseCommand, LaunchpadEvents } from "@bluecadet/launchpad-utils";
import { applyPatches, enablePatches, type Patch } from "immer";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { EventBus } from "../core/event-bus.js";
import type { LaunchpadState } from "../core/state-store.js";
import { IPCConnectionError, IPCMessageError, IPCTimeoutError } from "../errors.js";
import type { IPCBroadcastMessage, IPCMessage, IPCResponse } from "../transports/ipc-transport.js";
import { IPCSerializer } from "./ipc-serializer.js";
import { getOSSocketPath } from "./ipc-utils.js";

enablePatches();

type StateChangeHandler = (newState: LaunchpadState) => void;

export class IPCClient {
	private _socket: net.Socket | null = null;
	private _buffer = "";
	private _eventBus = new EventBus();
	private _pendingRequests = new Map<
		string,
		{
			resolve: (response: IPCResponse) => void;
			reject: (error: IPCConnectionError | IPCMessageError | IPCTimeoutError) => void;
		}
	>();
	private _nextId = 0;
	private _stateChangeListeners = new Set<StateChangeHandler>();
	private _lastState: Readonly<LaunchpadState> | null = null;
	private _lastStateVersion = -1;
	private static readonly DEFAULT_TIMEOUT_MS = 5000;

	/**
	 * Connect to the IPC socket
	 */
	connect(originalSocketPath: string): ResultAsync<void, IPCConnectionError> {
		const socketPath = getOSSocketPath(originalSocketPath);

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
	 * Subscribe to an event with type-safe handler.
	 * Events are emitted by the controller and streamed to all connected clients.
	 */
	on<K extends keyof LaunchpadEvents>(event: K, handler: (data: LaunchpadEvents[K]) => void): this {
		this._eventBus.on(event, handler);
		return this;
	}

	/**
	 * Unsubscribe from an event
	 */
	off<K extends keyof LaunchpadEvents>(
		event: K,
		handler: (data: LaunchpadEvents[K]) => void,
	): this {
		this._eventBus.off(event, handler);
		return this;
	}

	/**
	 * Subscribe to an event once (auto-unsubscribes after first emission)
	 */
	once<K extends keyof LaunchpadEvents>(
		event: K,
		handler: (data: LaunchpadEvents[K]) => void,
	): this {
		this._eventBus.once(event, handler);
		return this;
	}

	/**
	 * Subscribe to all events with a wildcard handler with full type safety
	 */
	onAny(
		handler: <K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]) => void,
	): this {
		this._eventBus.onAny(handler);
		return this;
	}

	/**
	 * Unsubscribe a wildcard handler
	 */
	offAny(
		handler: <K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]) => void,
	): this {
		this._eventBus.offAny(handler);
		return this;
	}

	/**
	 * Query the controller's current state
	 */
	queryState(): ResultAsync<LaunchpadState, IPCConnectionError | IPCMessageError> {
		const message: IPCMessage = {
			type: "query-state",
			id: this._generateId(),
		};

		return this._sendMessage(message).andThen((response) => {
			if (response.type === "state") {
				// remove _version before returning
				const { _version, ...state } = response.data;
				Object.freeze(state);
				this._lastState = state;
				this._lastStateVersion = response.data._version;
				return okAsync(state);
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
	 * Register a listener for state changes
	 * Returns an unsubscribe function
	 */
	onStateChange(listener: (newState: LaunchpadState) => void): () => void {
		this._stateChangeListeners.add(listener);
		return () => {
			this._stateChangeListeners.delete(listener);
		};
	}

	private _handlePatch(
		patches: Patch[],
		version: number,
	): ResultAsync<void, IPCMessageError | IPCConnectionError> {
		// If we missed versions (or don't have an initial state yet), re-query full state
		if (!this._lastState || version !== this._lastStateVersion + 1) {
			return this.queryState().map((state) => {
				this._stateChangeListeners.forEach((listener) => {
					listener(state);
				});
			});
		}

		try {
			this._lastState = applyPatches(this._lastState, patches);
			this._lastStateVersion = version;
		} catch (e) {
			return errAsync(new IPCMessageError("Failed to apply patches"));
		}

		// create a copy without _version
		const stateRef = this._lastState;

		this._stateChangeListeners.forEach((listener) => {
			listener(stateRef);
		});

		return okAsync(undefined);
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

				const data = `${IPCSerializer.serialize(message)}\n`;
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
				const message = IPCSerializer.deserialize(line) as IPCResponse | IPCBroadcastMessage;

				// Handle events (no id field)
				if (message.type === "event") {
					this._eventBus.emit(message.name as keyof LaunchpadEvents, message.data);
					continue;
				}

				if (message.type === "state-patch") {
					this._handlePatch(message.patches, message.version);
					continue;
				}

				// Handle request-response messages (has id field)
				const response = message;
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
