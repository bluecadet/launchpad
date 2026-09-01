/**
 * One SSE connection, shared by every subscription on a client.
 *
 * Sharing matters: the transport enforces a `maxClients` cap, and gap detection is
 * per-connection — a client that opened three streams would have three baselines to
 * reconcile. The connection opens when the first subscriber arrives and closes when the
 * last one leaves.
 */

import { ClientError, type ClientErrorReason } from "./errors.js";
import { authHeaders, type HttpConfig, isRecord } from "./http.js";
import { createSequenceTracker } from "./sequence.js";
import { createSseParser } from "./sse-parser.js";
import type { SubscribeOptions, Unsubscribe } from "./types.js";

/** One event off the stream. `data` is opaque here; `on()` types it per event name. */
export type EventFrame = {
	readonly event: string;
	readonly data: unknown;
	/** The frame's sequence number. Absent on a replayed frame. */
	readonly seq?: number;
	/** True for a frame served from the replay backlog rather than broadcast live. */
	readonly replayed: boolean;
};

/**
 * The state of the stream itself.
 *
 * `reconnected` and `gap` both mean the same thing to a caller: whatever you built from
 * this stream may be stale, so re-read the authoritative source. Use
 * {@link isResyncSignal} rather than listing them by hand.
 */
export type ConnectionEvent =
	| { readonly type: "connected" }
	| { readonly type: "reconnected" }
	| { readonly type: "gap"; readonly expected: number; readonly received: number }
	| {
			readonly type: "disconnected";
			readonly error?: ClientError;
			/**
			 * True when the SDK gave up rather than backing off: the Node answered `/events`
			 * with a failure no retry can fix. Nothing reconnects until a new subscription
			 * opens a fresh connection.
			 */
			readonly terminal?: boolean;
	  };

/** True for the two events that mean "re-query the authoritative source". */
export function isResyncSignal(event: ConnectionEvent): boolean {
	return event.type === "reconnected" || event.type === "gap";
}

export type StreamListener = {
	onFrame?: (frame: EventFrame) => void;
	onConnection?: (event: ConnectionEvent) => void;
};

export type EventStream = {
	subscribe(listener: StreamListener, options?: SubscribeOptions): Unsubscribe;
	/** Drop every subscriber and close the connection. */
	close(): void;
};

export type EventStreamOptions = {
	onError?: (error: ClientError) => void;
	/** Overrides the server's `retry:` hint as the base reconnect delay. */
	reconnectDelayMs?: number;
	/** Ceiling for exponential backoff. */
	maxReconnectDelayMs?: number;
};

const DEFAULT_RETRY_MS = 2000;
const DEFAULT_MAX_RETRY_MS = 30000;

/**
 * Rejections a retry can never clear: a revoked token, a role that does not cover
 * `/events`, or a wrong `baseUrl`. Backing off against these forever would flood an
 * unattended Station's logs with a failure only an operator can fix.
 */
const TERMINAL_REASONS = new Set<ClientErrorReason>(["unauthorized", "forbidden", "not-found"]);

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(finish, ms);
		signal.addEventListener("abort", finish, { once: true });
		function finish() {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		}
	});
}

function statusError(status: number, body: string): ClientError {
	const parsed = safeParse(body);
	const message =
		isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string"
			? parsed.error.message
			: `GET /events failed with ${status}`;
	return new ClientError(status === 503 ? "unavailable" : reasonFor(status), message, { status });
}

function reasonFor(status: number) {
	if (status === 401) {
		return "unauthorized" as const;
	}
	if (status === 403) {
		return "forbidden" as const;
	}
	if (status === 404) {
		return "not-found" as const;
	}
	return status >= 500 ? ("server-error" as const) : ("unknown" as const);
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

type ParsedPayload = { ok: true; value: unknown } | { ok: false };

function parsePayload(raw: string): ParsedPayload {
	try {
		return { ok: true, value: JSON.parse(raw) };
	} catch {
		return { ok: false };
	}
}

export function createEventStream(
	config: HttpConfig,
	options: EventStreamOptions = {},
): EventStream {
	const listeners = new Set<StreamListener>();
	const maxDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RETRY_MS;
	// One tracker for the life of the client, not one per run loop: "has ever connected"
	// belongs to the client, so the connection that follows the last subscriber leaving is
	// still a reconnect — a gap by the contract's rules, whoever is listening for it.
	const tracker = createSequenceTracker();
	let connection: AbortController | null = null;
	let retryMs = options.reconnectDelayMs ?? DEFAULT_RETRY_MS;

	function notifyConnection(event: ConnectionEvent) {
		for (const listener of [...listeners]) {
			listener.onConnection?.(event);
		}
	}

	function notifyFrame(frame: EventFrame) {
		for (const listener of [...listeners]) {
			listener.onFrame?.(frame);
		}
	}

	function report(error: ClientError) {
		options.onError?.(error);
	}

	async function openStream(signal: AbortSignal) {
		const url = `${config.baseUrl}/events`;
		try {
			const response = await config.fetchFn(url, {
				method: "GET",
				headers: { ...authHeaders(config.token), accept: "text/event-stream" },
				signal,
			});
			if (!response.ok) {
				const body = await response.text();
				return { ok: false as const, error: statusError(response.status, body) };
			}
			if (!response.body) {
				return {
					ok: false as const,
					error: new ClientError("malformed-response", "GET /events returned no body"),
				};
			}
			return { ok: true as const, body: response.body };
		} catch (cause) {
			return {
				ok: false as const,
				error: new ClientError("network", "Could not open the event stream", { cause }),
			};
		}
	}

	/** Resolves when the stream ends, with the error that ended it if there was one. */
	async function readStream(
		body: ReadableStream<Uint8Array>,
		onFrameReceived: () => void,
	): Promise<ClientError | undefined> {
		const parser = createSseParser({
			onRetry: (delayMs) => {
				if (options.reconnectDelayMs === undefined) {
					retryMs = delayMs;
				}
			},
			onFrame: (frame) => {
				onFrameReceived();
				const seq = frame.id === undefined ? undefined : Number(frame.id);
				const check = tracker.check(seq);
				if (check.gap) {
					notifyConnection({ type: "gap", expected: check.expected, received: check.received });
				}
				const payload = parsePayload(frame.data);
				if (!payload.ok) {
					report(
						new ClientError(
							"malformed-response",
							`Event frame '${frame.event}' carried a payload that is not JSON`,
						),
					);
					return;
				}
				notifyFrame({
					event: frame.event,
					data: payload.value,
					...(seq === undefined ? {} : { seq }),
					replayed: frame.id === undefined,
				});
			},
		});

		const reader = body.getReader();
		const decoder = new TextDecoder();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					return undefined;
				}
				parser.push(decoder.decode(value, { stream: true }));
			}
		} catch (cause) {
			return new ClientError("network", "The event stream dropped", { cause });
		}
	}

	async function run(signal: AbortSignal) {
		let failures = 0;

		while (!signal.aborted) {
			const opened = await openStream(signal);
			if (signal.aborted) {
				return;
			}
			if (!opened.ok) {
				report(opened.error);
				const terminal = TERMINAL_REASONS.has(opened.error.reason);
				notifyConnection({
					type: "disconnected",
					error: opened.error,
					...(terminal ? { terminal: true } : {}),
				});
				if (terminal) {
					return;
				}
				failures += 1;
				await delay(Math.min(retryMs * 2 ** (failures - 1), maxDelayMs), signal);
				continue;
			}

			notifyConnection({ type: tracker.open() });
			// A connection that delivered nothing is treated as a failed one, so a server
			// that accepts and immediately drops still backs off.
			const error = await readStream(opened.body, () => {
				failures = 0;
			});
			if (signal.aborted) {
				return;
			}
			if (error) {
				report(error);
			}
			notifyConnection({ type: "disconnected", ...(error ? { error } : {}) });
			failures += 1;
			await delay(Math.min(retryMs * 2 ** (failures - 1), maxDelayMs), signal);
		}
	}

	function ensureConnected() {
		if (connection !== null) {
			return;
		}
		connection = new AbortController();
		void run(connection.signal);
	}

	function disconnect() {
		connection?.abort();
		connection = null;
	}

	return {
		subscribe(listener, subscribeOptions) {
			if (subscribeOptions?.signal?.aborted) {
				return () => undefined;
			}
			listeners.add(listener);
			ensureConnected();

			let active = true;
			const unsubscribe = () => {
				if (!active) {
					return;
				}
				active = false;
				subscribeOptions?.signal?.removeEventListener("abort", unsubscribe);
				listeners.delete(listener);
				if (listeners.size === 0) {
					disconnect();
				}
			};
			subscribeOptions?.signal?.addEventListener("abort", unsubscribe, { once: true });
			return unsubscribe;
		},

		close() {
			listeners.clear();
			disconnect();
		},
	};
}
