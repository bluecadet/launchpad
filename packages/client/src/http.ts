/**
 * The three request/response routes: `POST /command`, `GET /status`, `GET /state`.
 *
 * Every failure is mapped onto a `reason` here rather than at the call site, because the
 * mapping is subtle in two places the wire contract calls out: a `400` can be a malformed
 * request *or* a command whose own parameters failed their schema, and a `404` can be an
 * unknown route *or* a command no plugin on this Node implements. Both pairs are told
 * apart by whether the body carries `error.reason`, never by the status code alone.
 */

import type { CommandFailureReason, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { StatusSnapshot } from "@bluecadet/launchpad-utils/types";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import {
	ClientError,
	type ClientErrorReason,
	CommandError,
	type CommandRejectionReason,
	type SerializedError,
} from "./errors.js";
import type { VersionedWireState } from "./types.js";

/** The `fetch` this SDK calls. Injectable so tests and exotic runtimes can substitute. */
export type FetchLike = typeof globalThis.fetch;

/** Everything a request needs, resolved once when the client is created. */
export type HttpConfig = {
	/** Origin plus any base path, without a trailing slash. */
	readonly baseUrl: string;
	readonly token?: string;
	readonly fetchFn: FetchLike;
};

/**
 * The `reason` values a Node puts on a `POST /command` failure body: the three
 * dispatch-failure reasons, plus the two pre-dispatch rejection reasons. Anything else
 * on the wire is untrusted and must fall back to the status code.
 */
const TRUSTED_WIRE_REASONS = [
	"not-registered",
	"invalid",
	"handler-failed",
	"not-allowed",
	"role-denied",
] as const satisfies readonly (CommandFailureReason | CommandRejectionReason)[];

const TRUSTED_WIRE_REASON_SET: ReadonlySet<string> = new Set(TRUSTED_WIRE_REASONS);

/** Narrows a wire `reason` string to the reasons a Node is known to send. */
function isWireReason(value: string): value is CommandFailureReason | CommandRejectionReason {
	return TRUSTED_WIRE_REASON_SET.has(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" ? value : undefined;
}

/** Bearer auth on every route, including `GET /events`. */
export function authHeaders(token: string | undefined): Record<string, string> {
	return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

/** Trailing slashes would produce `//events`, which is a different (404) route. */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function statusReason(status: number): ClientErrorReason {
	switch (status) {
		case 400:
			return "bad-request";
		case 401:
			return "unauthorized";
		case 403:
			return "forbidden";
		case 404:
			return "not-found";
		case 413:
			return "too-large";
		case 503:
			return "unavailable";
		default:
			return status >= 500 ? "server-error" : "unknown";
	}
}

type ErrorBody = {
	readonly message?: string;
	readonly reason?: string;
	readonly commandType?: string;
	readonly cause?: SerializedError;
};

/**
 * Pull the `{"error":{...}}` envelope out of a failure body.
 *
 * Tolerates every shape the contract allows a body to degrade into, including a bare JSON
 * string (which is what a response whose serialization threw looks like on the wire).
 */
function readErrorBody(parsed: unknown): ErrorBody {
	if (!isRecord(parsed) || !isRecord(parsed.error)) {
		return {};
	}
	const error = parsed.error;
	return {
		message: readString(error, "message"),
		reason: readString(error, "reason"),
		commandType: readString(error, "commandType"),
		cause: isRecord(error.cause) ? error.cause : undefined,
	};
}

function failureMessage(status: number, body: ErrorBody, rawBody: string): string {
	if (body.message !== undefined) {
		return body.message;
	}
	const detail = rawBody.trim().slice(0, 200);
	return detail.length > 0 ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

function networkError(path: string, cause: unknown): ClientError {
	return new ClientError("network", `Request to ${path} failed`, { cause });
}

type RawResponse = { status: number; ok: boolean; body: string };

function readResponse(config: HttpConfig, path: string, init?: RequestInit) {
	const url = `${config.baseUrl}${path}`;
	return ResultAsync.fromPromise(config.fetchFn(url, init), (cause) =>
		networkError(path, cause),
	).andThen((response) =>
		ResultAsync.fromPromise(response.text(), (cause) => networkError(path, cause)).map(
			(body): RawResponse => ({ status: response.status, ok: response.ok, body }),
		),
	);
}

function parseJson(path: string, raw: RawResponse): Result<unknown, ClientError> {
	try {
		return ok(JSON.parse(raw.body));
	} catch (cause) {
		return err(
			new ClientError("malformed-response", `Response from ${path} was not JSON`, {
				status: raw.status,
				cause,
			}),
		);
	}
}

type RequestOptions = {
	/** Override for routes where a 404 means something other than "no such route". */
	readonly notFoundReason?: ClientErrorReason;
};

/** GET a JSON object, or fail with a mapped {@link ClientError}. */
export function requestJson(
	config: HttpConfig,
	path: string,
	options: RequestOptions = {},
): ResultAsync<unknown, ClientError> {
	const init: RequestInit = { method: "GET", headers: authHeaders(config.token) };

	return readResponse(config, path, init).andThen((raw) => {
		if (raw.ok) {
			return parseJson(path, raw);
		}
		const body = readErrorBody(safeParse(raw.body));
		const reason =
			raw.status === 404 && options.notFoundReason !== undefined
				? options.notFoundReason
				: statusReason(raw.status);
		return err(
			new ClientError(reason, failureMessage(raw.status, body, raw.body), {
				status: raw.status,
				cause: body.cause,
			}),
		);
	});
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export function getStatus(config: HttpConfig): ResultAsync<StatusSnapshot, ClientError> {
	return requestJson(config, "/status").andThen((body) => {
		if (!isRecord(body) || !isRecord(body.header) || !Array.isArray(body.sections)) {
			return errAsync(
				new ClientError("malformed-response", "GET /status did not return a status snapshot"),
			);
		}
		return okAsync(body as unknown as StatusSnapshot);
	});
}

export function getState(config: HttpConfig): ResultAsync<VersionedWireState, ClientError> {
	return requestJson(config, "/state", { notFoundReason: "state-not-exposed" }).andThen((body) => {
		if (!isRecord(body) || !isRecord(body.system) || typeof body._version !== "number") {
			return errAsync(
				new ClientError("malformed-response", "GET /state did not return a state snapshot"),
			);
		}
		return okAsync(body as unknown as VersionedWireState);
	});
}

/**
 * Dispatch a command and unwrap its `result`.
 *
 * A `200` always carries a `result` key, even for a command that resolves with nothing —
 * that arrives as `null`, indistinguishable from a command that resolves `null` on
 * purpose.
 */
export function executeCommand<TResult = unknown>(
	config: HttpConfig,
	type: CommandId,
	params?: Record<string, unknown>,
): ResultAsync<TResult, CommandError> {
	const init: RequestInit = {
		method: "POST",
		headers: { ...authHeaders(config.token), "content-type": "application/json" },
		body: JSON.stringify({ ...params, type }),
	};

	return readResponse(config, "/command", init)
		.mapErr((error) => toCommandError(error, type))
		.andThen((raw) => {
			if (!raw.ok) {
				return err(commandFailure(raw, type));
			}
			const parsed = safeParse(raw.body);
			if (!isRecord(parsed) || !("result" in parsed)) {
				return err(
					new CommandError("malformed-response", `Command '${type}' returned no result`, {
						status: raw.status,
						commandType: type,
					}),
				);
			}
			return ok(parsed.result as TResult);
		});
}

function toCommandError(error: ClientError, type: CommandId): CommandError {
	return new CommandError(error.reason, error.message, {
		status: error.status ?? undefined,
		commandType: type,
		cause: error.cause,
	});
}

/**
 * An unrecognized `reason` falls back to the status code: the contract catalogues new
 * reasons as an additive change, so a client must never treat one as fatal.
 */
function commandFailure(raw: RawResponse, type: CommandId): CommandError {
	const body = readErrorBody(safeParse(raw.body));
	const reason =
		body.reason !== undefined && isWireReason(body.reason) ? body.reason : statusReason(raw.status);

	return new CommandError(reason, failureMessage(raw.status, body, raw.body), {
		status: raw.status,
		commandType: body.commandType ?? type,
		cause: body.cause,
	});
}
