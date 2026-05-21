/**
 * IPC Client for communicating with persistent controller.
 * Used by CLI commands like `status` and `stop`.
 */

import net from "node:net";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, StatusSnapshot } from "@bluecadet/launchpad-utils/types";
import { applyPatches, enablePatches, type Patch } from "immer";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { AllEvents } from "./all-events.js";
import { IPCConnectionError, IPCMessageError, IPCTimeoutError } from "./errors.js";
import type { IPCErrorResponse, IPCSuccessResponse } from "./transports/ipc-transport.js";
import { IPCSerializer } from "./utils/ipc-serializer.js";
import { getOSSocketPath } from "./utils/ipc-utils.js";

enablePatches();

type StateChangeHandler = (newState: LaunchpadState) => void;

type IPCResponse = IPCSuccessResponse | IPCErrorResponse;

type IPCRequest = {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: unknown;
};

type IPCNotification = {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
};

export class IPCClient {
	private _socket: net.Socket | null = null;
	private _buffer = "";
	private _eventBus = new EventBus<AllEvents>();
	private _pendingRequests = new Map<
		number,
		{
			resolve: (response: IPCResponse) => void;
			reject: (error: IPCConnectionError | IPCMessageError | IPCTimeoutError) => void;
		}
	>();
	private _nextId = 0;
	private _stateChangeListeners = new Set<StateChangeHandler>();
	private _statusSnapshotListeners = new Set<(s: StatusSnapshot) => void>();
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
					this._socket = null;
					reject(
						new IPCConnectionError(`Failed to connect to IPC socket at "${socketPath}"`, {
							cause: ensureError(error),
						}),
					);
				});

				this._socket.on("data", (data) => {
					this._handleData(data);
				});

				this._socket.on("close", () => {
					this._socket = null;
					// Reject all pending requests
					for (const request of this._pendingRequests.values()) {
						request.reject(new IPCConnectionError("Socket closed unexpectedly"));
					}
					this._pendingRequests.clear();
				});
			}),
			(e) =>
				new IPCConnectionError("IPC connection failed", {
					cause: ensureError(e),
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
	on<K extends keyof AllEvents>(event: K, handler: (data: AllEvents[K]) => void): this {
		this._eventBus.on(event, handler);
		return this;
	}

	/**
	 * Unsubscribe from an event
	 */
	off<K extends keyof AllEvents>(event: K, handler: (data: AllEvents[K]) => void): this {
		this._eventBus.off(event, handler);
		return this;
	}

	/**
	 * Subscribe to an event once (auto-unsubscribes after first emission)
	 */
	once<K extends keyof AllEvents>(event: K, handler: (data: AllEvents[K]) => void): this {
		this._eventBus.once(event, handler);
		return this;
	}

	/**
	 * Subscribe to all events with a wildcard handler with full type safety
	 */
	onAny(handler: <K extends keyof AllEvents>(event: K, data: AllEvents[K]) => void): this {
		this._eventBus.onAny(handler);
		return this;
	}

	/**
	 * Unsubscribe a wildcard handler
	 */
	offAny(handler: <K extends keyof AllEvents>(event: K, data: AllEvents[K]) => void): this {
		this._eventBus.offAny(handler);
		return this;
	}

	/**
	 * Query the controller's current state
	 */
	queryState(): ResultAsync<LaunchpadState, IPCConnectionError | IPCMessageError> {
		const id = this._nextId++;
		const message: IPCRequest = { jsonrpc: "2.0", id, method: "queryState" };

		return this._sendMessage(message).andThen((response) => {
			if ("result" in response) {
				const versionedState = response.result as { _version: number } & LaunchpadState;
				const { _version, ...state } = versionedState;
				Object.freeze(state);
				this._lastState = state as LaunchpadState;
				this._lastStateVersion = _version;
				return okAsync(state as LaunchpadState);
			}
			return errAsync(new IPCMessageError("Controller error", { cause: response.error.data }));
		});
	}

	/**
	 * Execute a command on the controller
	 */
	executeCommand(command: BaseCommand): ResultAsync<unknown, IPCConnectionError | IPCMessageError> {
		const id = this._nextId++;
		const message: IPCRequest = { jsonrpc: "2.0", id, method: "executeCommand", params: command };

		return this._sendMessage(message).andThen((response) => {
			if ("result" in response) {
				return okAsync(response.result);
			}
			return errAsync(
				new IPCMessageError(`Error dispatching command: ${command.type}`, {
					cause: response.error.data,
				}),
			);
		});
	}

	/**
	 * Send shutdown command to the controller
	 */
	shutdown(): ResultAsync<void, IPCConnectionError | IPCMessageError> {
		const id = this._nextId++;
		const message: IPCRequest = { jsonrpc: "2.0", id, method: "shutdown" };

		return this._sendMessage(message).andThen((response) => {
			if ("result" in response) {
				return okAsync(undefined);
			}
			return errAsync(new IPCMessageError("Shutdown error", { cause: response.error.data }));
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

	/**
	 * Query the controller's current status snapshot
	 */
	queryStatusSnapshot(): ResultAsync<StatusSnapshot, IPCConnectionError | IPCMessageError> {
		const id = this._nextId++;
		const message: IPCRequest = { jsonrpc: "2.0", id, method: "queryStatusSnapshot" };
		return this._sendMessage(message).andThen((response) => {
			if ("result" in response) {
				return okAsync(response.result as StatusSnapshot);
			}
			return errAsync(new IPCMessageError("Controller error", { cause: response.error.data }));
		});
	}

	/**
	 * Register a listener for status snapshot push notifications.
	 * Returns an unsubscribe function.
	 */
	onStatusSnapshotChange(listener: (snapshot: StatusSnapshot) => void): () => void {
		this._statusSnapshotListeners.add(listener);
		return () => {
			this._statusSnapshotListeners.delete(listener);
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
		} catch (_e) {
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
		message: IPCRequest,
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
								cause: ensureError(error),
							}),
						);
					}
				});
			}),
			(e) =>
				e instanceof IPCConnectionError || e instanceof IPCTimeoutError
					? e
					: new IPCMessageError("Failed to process IPC response", {
							cause: ensureError(e),
						}),
		);
	}

	/**
	 * Handle incoming data from socket
	 */
	private _handleData(data: Buffer | string): void {
		this._buffer += data.toString();

		// Process complete messages (newline-delimited)
		const lines = this._buffer.split("\n");
		this._buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;

			try {
				const message = IPCSerializer.deserialize(line) as IPCResponse | IPCNotification;

				// Notifications have `method` but no `id`
				if ("method" in message && !("id" in message)) {
					const notification = message as IPCNotification;
					if (notification.method === "event") {
						const params = notification.params as {
							name: keyof AllEvents;
							data: AllEvents[keyof AllEvents];
						};
						this._eventBus.emit(params.name, params.data);
					} else if (notification.method === "statePatch") {
						const params = notification.params as { patches: Patch[]; version: number };
						void this._handlePatch(params.patches, params.version);
					} else if (notification.method === "statusSnapshot") {
						const snapshot = notification.params as StatusSnapshot;
						this._statusSnapshotListeners.forEach((listener) => {
							listener(snapshot);
						});
					}
					continue;
				}

				// Request-response: has `id`
				const response = message as IPCResponse;
				const request = this._pendingRequests.get(response.id);

				if (request) {
					this._pendingRequests.delete(response.id);
					request.resolve(response);
				}
			} catch (e) {
				// Reject all pending requests with parse error
				const error = ensureError(e);
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
}
