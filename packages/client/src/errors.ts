/**
 * Every failure this SDK can hand back, as two `Error` subclasses carrying a `reason`
 * field to branch on.
 *
 * `reason` is the discriminator, never `message`: the wire contract reserves the right to
 * reword every message on it, and it catalogues new `reason` values as an additive
 * (non-breaking) change. Anything this SDK does not recognize collapses onto the status
 * code, and a status code it does not recognize collapses onto `"unknown"` — an
 * exhaustive `switch` over these unions must always have a default arm.
 */

import type { CommandFailureReason } from "@bluecadet/launchpad-utils/plugin-interfaces";

/**
 * An `Error` as the transport serializes it: name and message, plus one more nested
 * `cause` when the original error chained one.
 */
export type SerializedError = {
	readonly name?: string;
	readonly message?: string;
	readonly cause?: SerializedError;
};

/** Why a `GET /status`, `GET /state`, or SSE request failed. */
export type ClientErrorReason =
	/** No token, or one the Node does not recognize. HTTP 401. */
	| "unauthorized"
	/** The token is valid but not permitted here. HTTP 403. */
	| "forbidden"
	/** The Node rejected the request itself. HTTP 400. */
	| "bad-request"
	/** No such route on this Node — usually a wrong `baseUrl`. HTTP 404. */
	| "not-found"
	/** `GET /state` answered 404: the operator did not set `exposeState`. */
	| "state-not-exposed"
	/** Body over the transport's 64KB limit. HTTP 413. */
	| "too-large"
	/** The Node is shutting down, or `/events` is at `maxClients`. HTTP 503. */
	| "unavailable"
	/** Any other 5xx. */
	| "server-error"
	/** `fetch` never got an answer: no route to the Node, DNS, TLS, CORS, abort. */
	| "network"
	/** A 2xx whose body was not the JSON shape the contract promises. */
	| "malformed-response"
	/** A status code this SDK has no mapping for. */
	| "unknown";

/**
 * Why a `POST /command` failed. The first three come from the Node's own
 * `error.reason` field; the rest are transport-level failures that never reached a
 * command handler.
 */
export type CommandErrorReason = CommandFailureReason | ClientErrorReason;

type ClientErrorOptions = {
	readonly status?: number;
	readonly cause?: unknown;
};

/** Failure of any request that is not a command dispatch. */
export class ClientError extends Error {
	override readonly name = "ClientError";
	readonly reason: ClientErrorReason;
	/** HTTP status, or `null` when the request never got a response. */
	readonly status: number | null;

	constructor(reason: ClientErrorReason, message: string, options?: ClientErrorOptions) {
		super(message, { cause: options?.cause });
		this.reason = reason;
		this.status = options?.status ?? null;
	}
}

type CommandErrorOptions = ClientErrorOptions & {
	/** Canonical id of the command that failed — not always the `type` that was sent. */
	readonly commandType?: string;
};

/** Failure of a `POST /command` dispatch. */
export class CommandError extends Error {
	override readonly name = "CommandError";
	readonly reason: CommandErrorReason;
	readonly status: number | null;
	/**
	 * Canonical id of the command that failed. The Node resolves an alias to its
	 * canonical id before dispatch, so this can differ from the `type` that was sent.
	 */
	readonly commandType: string;

	constructor(reason: CommandErrorReason, message: string, options?: CommandErrorOptions) {
		super(message, { cause: options?.cause });
		this.reason = reason;
		this.status = options?.status ?? null;
		this.commandType = options?.commandType ?? "";
	}
}

/** Either failure channel, for the client-wide `onError` callback. */
export type LaunchpadClientError = ClientError | CommandError;
