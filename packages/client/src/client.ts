/**
 * `createClient` — the whole public surface, composed from the request layer, the shared
 * SSE stream, the state mirror, and the session view.
 */

import type { CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadEvents, StatusSnapshot } from "@bluecadet/launchpad-utils/types";
import type { ResultAsync } from "neverthrow";
import type { ClientError, CommandError, LaunchpadClientError } from "./errors.js";
import { type ConnectionEvent, createEventStream, type EventFrame } from "./event-stream.js";
import {
	executeCommand,
	type FetchLike,
	getState,
	getStatus,
	type HttpConfig,
	normalizeBaseUrl,
} from "./http.js";
import { subscribeState } from "./state-mirror.js";
import type { SubscribeOptions, Unsubscribe, VersionedWireState } from "./types.js";

/** Every event name declared on the merged `LaunchpadEvents` map. */
export type EventName = keyof LaunchpadEvents & string;

export type EventHandler<TName extends EventName> = (
	data: LaunchpadEvents[TName],
	frame: EventFrame,
) => void;

export type ClientOptions = {
	/** Origin of the Node's HTTP transport, e.g. `http://127.0.0.1:8710`. */
	baseUrl: string;
	/** Bearer token, when the operator configured `auth.tokens`. */
	token?: string;
	/** Substitute for `globalThis.fetch`. Must support streaming response bodies. */
	fetch?: FetchLike;
	/**
	 * Base delay before reconnecting a dropped event stream, in milliseconds. Defaults to
	 * the server's own `retry:` hint; set this to override it. Backoff doubles from here
	 * on each consecutive failure.
	 */
	reconnectDelayMs?: number;
	/** Ceiling for reconnect backoff, in milliseconds. Defaults to 30000. */
	maxReconnectDelayMs?: number;
	/**
	 * Called for failures that happen off the back of a subscription — a state refetch
	 * that failed, a dropped stream — where there is no `Result` to return. Recovery is
	 * automatic either way; this is for logging.
	 */
	onError?: (error: LaunchpadClientError) => void;
};

export type LaunchpadClient = {
	/** The normalized base URL every request is sent to. */
	readonly baseUrl: string;

	/**
	 * Dispatch a command. Resolves with the command's own result, which is `null` for a
	 * command that resolves with nothing.
	 */
	executeCommand<TResult = unknown>(
		type: CommandId,
		params?: Record<string, unknown>,
	): ResultAsync<TResult, CommandError>;

	/** Read the display-oriented status snapshot. Doubles as the liveness check. */
	getStatus(): ResultAsync<StatusSnapshot, ClientError>;

	/**
	 * Read the full state tree. Fails with `reason: "state-not-exposed"` unless the
	 * operator set `exposeState: true` on the transport.
	 */
	getState(): ResultAsync<VersionedWireState, ClientError>;

	/**
	 * Every frame on the event stream, including ones this SDK has no types for. `data` is
	 * `unknown` here on purpose — use {@link LaunchpadClient.on} for a typed payload.
	 */
	subscribeEvents(handler: (frame: EventFrame) => void, options?: SubscribeOptions): Unsubscribe;

	/**
	 * One event name, with its payload typed through the declaration-merged
	 * `LaunchpadEvents` map: importing a plugin package for its side effects is what
	 * brings that plugin's event types into scope.
	 */
	on<TName extends EventName>(
		event: TName,
		handler: EventHandler<TName>,
		options?: SubscribeOptions,
	): Unsubscribe;

	/**
	 * The state of the stream itself. A `reconnected` or `gap` event means anything built
	 * from the stream may be stale and the authoritative source should be re-read.
	 */
	onConnection(handler: (event: ConnectionEvent) => void, options?: SubscribeOptions): Unsubscribe;

	/**
	 * A live mirror of `GET /state`. The handler is called with a full state tree: once
	 * with the baseline read, then again on every change, and again from scratch whenever
	 * the mirror may have gone stale.
	 *
	 * Requires the operator to have enabled `exposeState` and `pushStatePatches` on the
	 * transport. Without the former the baseline read fails through `onError`; without the
	 * latter the handler is called once and never updates.
	 */
	subscribeStatePatches(
		handler: (state: VersionedWireState) => void,
		options?: SubscribeOptions,
	): Unsubscribe;

	/** Drop every subscription and close the event stream. */
	close(): void;
};

export function createClient(options: ClientOptions): LaunchpadClient {
	const config = resolveConfig(options);

	const stream = createEventStream(config, {
		onError: options.onError,
		reconnectDelayMs: options.reconnectDelayMs,
		maxReconnectDelayMs: options.maxReconnectDelayMs,
	});

	return {
		baseUrl: config.baseUrl,
		executeCommand: (type, params) => executeCommand(config, type, params),
		getStatus: () => getStatus(config),
		getState: () => getState(config),

		subscribeEvents: (handler, subscribeOptions) =>
			stream.subscribe({ onFrame: handler }, subscribeOptions),

		on: (event, handler, subscribeOptions) =>
			stream.subscribe(
				{
					onFrame: (frame) => {
						if (frame.event === event) {
							handler(frame.data as LaunchpadEvents[typeof event], frame);
						}
					},
				},
				subscribeOptions,
			),

		onConnection: (handler, subscribeOptions) =>
			stream.subscribe({ onConnection: handler }, subscribeOptions),

		subscribeStatePatches: (handler, subscribeOptions) =>
			subscribeState(
				{ fetchState: () => getState(config), stream, onError: options.onError },
				handler,
				subscribeOptions,
			),

		close: () => {
			stream.close();
		},
	};
}

function resolveConfig(options: ClientOptions): HttpConfig {
	const fetchFn = options.fetch ?? globalThis.fetch;
	if (typeof fetchFn !== "function") {
		throw new TypeError(
			"No fetch implementation available. Pass one as `fetch` when creating the client.",
		);
	}
	return {
		baseUrl: normalizeBaseUrl(options.baseUrl),
		token: options.token,
		// Unbound `globalThis.fetch` throws "Illegal invocation" in a browser.
		fetchFn: fetchFn.bind(globalThis),
	};
}
