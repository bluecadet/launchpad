/**
 * `createClient` — the whole public surface, composed from the request layer, the shared
 * SSE stream, the state mirror, and the session view.
 */

import type { CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { StatusSnapshot } from "@bluecadet/launchpad-utils/types";
import type { ResultAsync } from "neverthrow";
import type { ClientError, CommandError, LaunchpadClientError } from "./errors.js";
import {
	executeCommand,
	type FetchLike,
	getState,
	getStatus,
	type HttpConfig,
	normalizeBaseUrl,
} from "./http.js";
import type { VersionedWireState } from "./types.js";

export type ClientOptions = {
	/** Origin of the Node's HTTP transport, e.g. `http://127.0.0.1:8710`. */
	baseUrl: string;
	/** Bearer token, when the operator configured `auth.tokens`. */
	token?: string;
	/** Substitute for `globalThis.fetch`. Must support streaming response bodies. */
	fetch?: FetchLike;
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
};

export function createClient(options: ClientOptions): LaunchpadClient {
	const config = resolveConfig(options);

	return {
		baseUrl: config.baseUrl,
		executeCommand: (type, params) => executeCommand(config, type, params),
		getStatus: () => getStatus(config),
		getState: () => getState(config),
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
