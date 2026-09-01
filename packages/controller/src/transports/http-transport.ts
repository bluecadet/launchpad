/**
 * HTTP/SSE Transport for non-Node consumers (browsers, Unity, etc.).
 *
 * Exposes a small HTTP surface on localhost:
 * - `GET /events`  — Server-Sent Events stream of bus events (filtered)
 * - `POST /command` — dispatch an allowlisted command
 * - `GET /status`  — display-oriented status snapshot, including this Node's identity
 * - `GET /state`   — full global state (opt-in via `exposeState`)
 *
 * Push is best-effort sugar on top of the authoritative `manifest.json` poll
 * contract. Known limitations (accepted by design):
 * - SSE writes are fire-and-forget with no backpressure handling; slow clients
 *   may silently miss events.
 * - A failed port bind (e.g. EADDRINUSE) is a hard setup failure with no
 *   auto-recovery.
 * - Tokens are compared by plain map lookup, not a constant-time comparison;
 *   the v1 posture is a trusted exhibition VLAN, not a hostile network.
 * - Events are transport-global: every authenticated SSE client sees every
 *   event that passes the `events` filter, regardless of its token role. That
 *   includes pushed state patches and status snapshots.
 * - Every broadcast frame carries a monotonic `id:` sequence number, shared by
 *   all clients. A gap means re-query the authoritative source; there is no
 *   ring buffer and `Last-Event-ID` is not honored on reconnect. The `retry:`
 *   line, `: ping` keep-alives, and replay-backlog frames carry no `id:`.
 *
 * Nothing here may put a token value into a log line, into state, or onto the
 * wire. The transport keeps no state slice and has no `summarize()`, so
 * `/status` and `/state` are structurally token-free; request targets are
 * echoed only through `redactRequestTarget`, because `GET /events` accepts a
 * token as a query parameter.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import {
	type BaseCommand,
	type Disconnectable,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { StatusSnapshot, VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { Patch } from "immer";
import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from "neverthrow";
import { z } from "zod";
import type { AllEvents } from "../all-events.js";
import { TransportError } from "../errors.js";
import { serializeJSON } from "../utils/json-serializer.js";
import { UNSERIALIZABLE_PREFIX } from "../utils/serializer-placeholders.js";
import { type ClientHub, createClientHub } from "./client-hub.js";
import {
	type AuthOutcome,
	type AuthRegistry,
	httpAuthOptionsSchema,
	isLoopbackHost,
	redactRequestTarget,
	resolveAuthRegistry,
} from "./http-auth.js";
import { createPatternMatcher } from "./pattern-matcher.js";
import { closeServerAsResult, createShutdownGate, listenAsResult } from "./server-lifecycle.js";

const MAX_COMMAND_BODY_BYTES = 64 * 1024;

/**
 * Frame names the transport generates itself. Bus events under this prefix are
 * never forwarded, so a plugin emitting `launchpad:state:patch` on a transport
 * configured with `events: ["*"]` cannot forge a state frame into every client.
 */
const RESERVED_FRAME_PREFIX = "launchpad:";

const STATE_PATCH_FRAME = "launchpad:state:patch";
const STATUS_SNAPSHOT_FRAME = "launchpad:status:snapshot";

const httpTransportOptionsSchema = z
	.object({
		/** Port to listen on. `0` picks a random free port (useful for tests). */
		port: z.number().int().min(0).max(65535).default(8710),
		/** Host/interface to bind. */
		host: z.string().default("127.0.0.1"),
		/**
		 * Command types accepted by `POST /command`. Anything else gets a 403.
		 * Entries are prefix globs, matched like `events`. When `auth.tokens` is
		 * configured, the effective allowlist is this list intersected with the
		 * presented token's role globs, so a role can only ever narrow access.
		 */
		allowedCommands: z.array(z.string()).default(["content.ack", "content.manifest.read"]),
		/**
		 * Event names forwarded to SSE clients. An entry ending in `*` is a prefix
		 * match on the part before it; the single entry `*` matches all events;
		 * any other entry is an exact match.
		 */
		events: z.array(z.string()).default(["content:*"]),
		/**
		 * Event names cached and replayed to each newly connected SSE client, so it
		 * learns current state without waiting for the next emission. Exact names
		 * only, and an event must also pass the `events` filter to be emitted at
		 * all. Keep this to durable "current state" events: one-shot events (errors,
		 * progress) replayed hours later are misleading.
		 */
		replayEvents: z.array(z.string()).default(["content:version:promoted"]),
		/** Interval between `: ping` SSE comment lines. */
		keepAliveMs: z.number().int().positive().default(15000),
		/** Maximum concurrent SSE clients; further `GET /events` requests get a 503. */
		maxClients: z.number().int().positive().default(32),
		/** Expose the full global state at `GET /state`. Off by default. */
		exposeState: z.boolean().default(false),
		/**
		 * Push state-store patches to SSE clients as `launchpad:state:patch` frames,
		 * carrying the store's `_version` so a client can detect a gap in the state
		 * stream. Requires `exposeState`, which is the only way a client can recover
		 * from a detected gap.
		 */
		pushStatePatches: z.boolean().default(false),
		/**
		 * Push the display-oriented status snapshot to SSE clients as a
		 * `launchpad:status:snapshot` frame on every state change. Off by default: a
		 * full snapshot per patch batch is heavy, and building one runs every
		 * plugin's `summarize()`.
		 */
		pushStatusSnapshots: z.boolean().default(false),
		/**
		 * Token authentication. Empty (the default) leaves the transport
		 * unauthenticated, which is only defensible on loopback.
		 */
		auth: httpAuthOptionsSchema,
		/**
		 * Origins allowed to read responses cross-origin. `["*"]` (the default)
		 * answers with `Access-Control-Allow-Origin: *`. Any other list echoes the
		 * request's `Origin` when it matches and omits the header when it doesn't.
		 */
		allowedOrigins: z.array(z.string()).default(["*"]),
		/**
		 * Permit binding a non-loopback host with no tokens configured. Off by
		 * default: an unauthenticated LAN-reachable command endpoint is a setup
		 * error, not a warning.
		 */
		allowUnauthenticated: z.boolean().default(false),
	})
	.refine((parsed) => !parsed.pushStatePatches || parsed.exposeState, {
		message:
			"pushStatePatches requires exposeState: a client that detects a _version gap must be able to refetch full state from GET /state",
		path: ["pushStatePatches"],
	});

export type {
	AuthOutcome,
	AuthPrincipal,
	AuthRegistry,
	HttpAuthOptions,
} from "./http-auth.js";

export type HttpTransportOptions = z.input<typeof httpTransportOptionsSchema>;

type ResolvedHttpTransportOptions = z.output<typeof httpTransportOptionsSchema>;

export type HttpTransportInstance = Partial<Disconnectable> & {
	/**
	 * Address the server bound to, or `null` when nothing was bound (task mode).
	 * Set once, before `setup` resolves.
	 */
	readonly address: AddressInfo | null;
};

/**
 * Build a single SSE frame. Multi-line data is framed with one `data:` field
 * per line, per the SSE spec, so payloads survive EventSource reassembly.
 *
 * `seq` is written as the native SSE `id:` field, ahead of `event:`, so the
 * payload stays byte-identical to an unsequenced frame. Omit it for frames
 * that must not advance a client's baseline (the replay backlog).
 */
export function formatSseEvent(name: string, data: string, seq?: number): string {
	const lines = seq === undefined ? [`event: ${name}`] : [`id: ${seq}`, `event: ${name}`];
	for (const dataLine of data.split("\n")) {
		lines.push(`data: ${dataLine}`);
	}
	return `${lines.join("\n")}\n\n`;
}

/**
 * Create an HTTP/SSE transport plugin.
 *
 * In task mode the plugin is inert: one-shot runs never bind a port.
 */
export function httpTransport(options: HttpTransportOptions = {}) {
	return definePlugin({
		name: "http-transport",
		setup(ctx): ResultAsync<HttpTransportInstance, TransportError> {
			const parsedOptions = httpTransportOptionsSchema.safeParse(options);
			if (!parsedOptions.success) {
				return errAsync(
					new TransportError(`Invalid HTTP transport options: ${parsedOptions.error.message}`),
				);
			}
			const resolvedOptions = parsedOptions.data;

			// A role nothing points at is not a no-op: the operator wrote it
			// believing it did something. Same class of mistake as the non-loopback
			// guard below, so it gets the same treatment — a hard setup error, in
			// task mode too, not a warning that is easy to miss.
			if (
				Object.keys(resolvedOptions.auth.tokens).length === 0 &&
				Object.keys(resolvedOptions.auth.roles).length > 0
			) {
				return errAsync(
					new TransportError(
						"HTTP transport declares `auth.roles` with no `auth.tokens` configured: " +
							"no token can ever present one of these roles, so the transport starts fully " +
							"unauthenticated despite the role configuration. Configure `auth.tokens`, " +
							"or remove `auth.roles`.",
					),
				);
			}

			// Resolved before the task-mode return so a broken auth config (a token
			// naming an environment variable nobody set) fails a one-shot run too,
			// rather than waiting for the first daemon start to surface it.
			const authResult = resolveAuthRegistry(resolvedOptions.auth, process.env);
			if (authResult.isErr()) {
				return errAsync(authResult.error);
			}
			const auth = authResult.value;

			if (
				!auth.enabled &&
				!resolvedOptions.allowUnauthenticated &&
				!isLoopbackHost(resolvedOptions.host)
			) {
				return errAsync(
					new TransportError(
						`HTTP transport cannot bind non-loopback host "${resolvedOptions.host}" with no tokens configured: ` +
							"any host on the network could dispatch allowlisted commands. Configure `auth.tokens`, " +
							"or set `allowUnauthenticated: true` to accept that.",
					),
				);
			}

			if (ctx.mode === "task") {
				ctx.logger.verbose("HTTP transport inactive in task mode");
				return okAsync({ address: null });
			}

			// Token names are operator-authored labels, not secrets, so they are
			// safe to log — and they are the only audit trail an operator gets.
			if (auth.enabled) {
				ctx.logger.info(
					`HTTP transport auth enabled for ${auth.tokenNames.length} token(s): ${auth.tokenNames.join(", ")}`,
				);
			} else if (!isLoopbackHost(resolvedOptions.host)) {
				ctx.logger.warn(
					`HTTP transport is unauthenticated on non-loopback host "${resolvedOptions.host}"; any host that can reach the port can dispatch allowlisted commands`,
				);
			} else {
				ctx.logger.verbose("HTTP transport is unauthenticated (loopback, no tokens configured)");
			}

			const clients = createSseClientHub(ctx.logger);
			// Last frame seen per replayable event name, replayed to each new client
			// so it doesn't have to wait for the next emission to learn current
			// state. Insertion order is kept as last-emission order (see below), so
			// the backlog reads as a chronologically coherent history.
			const replayFrames = new Map<string, string>();
			const replayableEvents = new Set<string>(resolvedOptions.replayEvents);
			const passesEventFilter = createPatternMatcher(resolvedOptions.events);

			// One counter per transport, shared by every client, incremented only for
			// frames actually broadcast. A filtered-out event must not burn a seq:
			// that would look like a permanent gap to every client.
			let seq = 0;
			const broadcastFrame = (name: string, json: string) => {
				if (clients.size === 0) {
					return;
				}
				seq += 1;
				clients.broadcast(formatSseEvent(name, json, seq));
			};

			const handleBusEvent = <K extends keyof AllEvents>(event: K, data: AllEvents[K]) => {
				if (event.startsWith(RESERVED_FRAME_PREFIX)) {
					ctx.logger.warn(
						`Refusing to forward bus event "${event}": the "${RESERVED_FRAME_PREFIX}" prefix is reserved for transport-generated SSE frames`,
					);
					return;
				}
				if (!passesEventFilter(event)) {
					return;
				}
				if (!replayableEvents.has(event) && clients.size === 0) {
					return;
				}
				const json = serializeJSON(data);
				if (replayableEvents.has(event)) {
					// `Map.set` on an existing key keeps its original position, so drop
					// the old entry first to move the event to the back of the backlog.
					// Cached without a seq: a replayed frame belongs to one client's
					// backlog, so giving it an id would fake a gap for someone.
					replayFrames.delete(event);
					replayFrames.set(event, formatSseEvent(event, json));
				}
				broadcastFrame(event, json);
			};

			let warnedAboutLossyState = false;
			const warnIfLossy = (json: string) => {
				if (warnedAboutLossyState || !json.includes(UNSERIALIZABLE_PREFIX)) {
					return;
				}
				warnedAboutLossyState = true;
				ctx.logger.warn(
					"Pushed state contains values that do not survive JSON serialization (Map/Set/function/symbol/circular) and reach clients as placeholders. Keep pushed state slices JSON-native.",
				);
			};

			// Mirrors the IPC transport's statePatch/statusSnapshot pair, in the same
			// order: patch first, then the snapshot built from it.
			const handleStatePatch = (patches: Patch[], version: number) => {
				if (clients.size === 0) {
					return;
				}
				if (resolvedOptions.pushStatePatches) {
					const json = serializeJSON({ patches, version });
					warnIfLossy(json);
					broadcastFrame(STATE_PATCH_FRAME, json);
				}
				if (resolvedOptions.pushStatusSnapshots) {
					broadcastFrame(STATUS_SNAPSHOT_FRAME, serializeJSON(ctx.getStatusSnapshot()));
				}
			};
			const pushesState = resolvedOptions.pushStatePatches || resolvedOptions.pushStatusSnapshots;

			let keepAliveTimer: NodeJS.Timeout | undefined;
			let unsubscribeStatePatch: (() => void) | undefined;

			const server = http.createServer((req, res) => handleRequest(req, res, deps));
			const gate = createShutdownGate(() => {
				ctx.logger.verbose("HTTP transport is shutting down");
				ctx.eventBus.offAny(handleBusEvent);
				unsubscribeStatePatch?.();
				clearInterval(keepAliveTimer);
				clients.closeAll();
				server.closeIdleConnections();

				return closeServerAsResult(server, "Failed to close HTTP server").map(() => {
					ctx.logger.info("HTTP transport closed");
				});
			});

			const deps: RequestDeps = {
				ctx,
				options: resolvedOptions,
				clients,
				replayFrames,
				isShuttingDown: gate.isShuttingDown,
				auth,
				isCommandAllowed: createPatternMatcher(resolvedOptions.allowedCommands),
			};

			return listenAsResult(
				server,
				{ port: resolvedOptions.port, host: resolvedOptions.host },
				"Failed to start HTTP transport server",
			)
				.andThen(() => requireTcpAddress(server))
				.map((address) => {
					ctx.logger.info(`HTTP transport listening on http://${address.address}:${address.port}`);

					// Post-listen socket errors must not crash the process.
					server.on("error", (error) => {
						ctx.logger.error(`HTTP transport server error: ${error.message}`);
					});

					ctx.eventBus.onAny(handleBusEvent);
					if (pushesState) {
						unsubscribeStatePatch = ctx.onGlobalStatePatch(handleStatePatch);
					}

					keepAliveTimer = setInterval(() => {
						clients.broadcast(": ping\n\n");
					}, resolvedOptions.keepAliveMs);

					ctx.abortSignal.addEventListener(
						"abort",
						() => void gate.disconnect({ type: "manual" }),
						{
							once: true,
						},
					);

					return { address, disconnect: gate.disconnect };
				});
		},
	});
}

type SseClientHub = ClientHub<http.ServerResponse>;

/**
 * Fire-and-forget SSE fan-out. No backpressure handling: if a client's buffer
 * is full the data is queued or dropped by the socket, and slow clients may
 * miss events. Accepted limitation — the manifest poll contract stays
 * authoritative.
 */
function createSseClientHub(logger: PluginContext["logger"]): SseClientHub {
	return createClientHub<http.ServerResponse>({
		logger,
		label: "SSE client",
		write: (client, frame) => void client.write(frame),
		close: (client) => client.end(),
		isWritable: (client) => !client.writableEnded,
	});
}

type RequestDeps = {
	ctx: PluginContext;
	options: ResolvedHttpTransportOptions;
	clients: SseClientHub;
	replayFrames: ReadonlyMap<string, string>;
	isShuttingDown: () => boolean;
	auth: AuthRegistry;
	/** Transport-wide `allowedCommands` gate, applied before any role gate. */
	isCommandAllowed: (commandType: string) => boolean;
};

/** A listening `http.Server` always has a TCP address; guard the type anyway. */
function requireTcpAddress(server: http.Server): Result<AddressInfo, TransportError> {
	const address = server.address();
	if (address === null || typeof address === "string") {
		return err(new TransportError("HTTP server reported a non-TCP address"));
	}
	return ok(address);
}

// ---- Request routing ----

/** Every body the transport writes: a command envelope, an error, or a raw read. */
type HttpResponseBody = { result: unknown } | { error: Error | { message: string } } | ReadPayload;

type ReadPayload = StatusSnapshot | VersionedLaunchpadState;

/**
 * The order here is load-bearing:
 *
 * 1. A shutting-down transport answers 503 without doing auth work.
 * 2. CORS preflights are answered before the auth gate — browsers never send
 *    `Authorization` on an `OPTIONS`, so a 401 there breaks every browser
 *    client before the real request is ever made.
 * 3. The URL is parsed next, since authentication reads the query string.
 * 4. Authentication gates the whole surface, before routing, so an anonymous
 *    caller cannot enumerate routes by their status codes.
 *
 * Authorization (token role globs) is a separate, later gate: it applies to
 * `POST /command` only. Any valid token is therefore a full-read credential.
 */
function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	deps: RequestDeps,
): void {
	const cors = corsHeaders(req, deps.options);

	if (deps.isShuttingDown()) {
		sendJson(res, 503, { error: { message: "HTTP transport is shutting down" } }, cors);
		return;
	}

	const method = req.method ?? "GET";
	if (method === "OPTIONS") {
		sendCorsPreflight(res, cors);
		return;
	}

	let url: URL;
	try {
		url = new URL(req.url ?? "/", "http://local");
	} catch {
		// Redacted: `GET /events` accepts a token in the query string, and this
		// is the one branch that echoes a raw request target back to the client.
		sendJson(
			res,
			400,
			{ error: { message: `Invalid request target: ${redactRequestTarget(req.url)}` } },
			cors,
		);
		return;
	}

	const isEventStream = method === "GET" && url.pathname === "/events";
	const outcome = deps.auth.authenticate(req, url, isEventStream);
	logAuthOutcome(deps.ctx.logger, method, url.pathname, outcome);
	if (outcome.status === "unauthenticated") {
		sendUnauthorized(res, cors);
		return;
	}

	switch (`${method} ${url.pathname}`) {
		case "GET /events":
			handleEventStream(req, res, deps, cors);
			return;
		case "POST /command":
			void handleCommandRequest(req, res, deps, cors, outcome);
			return;
		case "GET /status":
			sendJson(res, 200, deps.ctx.getStatusSnapshot(), cors);
			return;
		case "GET /state":
			handleStateRequest(res, deps, cors);
			return;
		default:
			sendJson(res, 404, { error: { message: `Not found: ${method} ${url.pathname}` } }, cors);
	}
}

/**
 * Log an authentication outcome — the audit trail the token *name* exists
 * for. Never fed a token value: `AuthOutcome` structurally cannot carry one.
 *
 * An `anonymous` outcome (no tokens configured at all) is not logged: it is
 * the default, unauthenticated posture, not an event, and logging it would
 * put a line in the log for every single request to an open transport.
 *
 * Level split is deliberate: a success is routine and, on `POST /command`,
 * can be as hot as the caller wants — `debug` keeps that off `info` output
 * by default. A rejection is security-relevant regardless of volume, so it
 * stays at `warn`.
 */
function logAuthOutcome(
	logger: PluginContext["logger"],
	method: string,
	pathname: string,
	outcome: AuthOutcome,
): void {
	if (outcome.status === "authenticated") {
		logger.debug(
			`HTTP transport authenticated "${outcome.principal.tokenName}" (role "${outcome.principal.role}") for ${method} ${pathname}`,
		);
		return;
	}
	if (outcome.status === "unauthenticated") {
		logger.warn(`HTTP transport rejected ${method} ${pathname}: missing or unknown token`);
	}
}

type CorsHeaders = Record<string, string>;

/**
 * CORS is a browser-side control: omitting `Access-Control-Allow-Origin` stops
 * a page from reading the response, but the request still ran and non-browser
 * clients (Unity, curl) are unaffected. It is never a substitute for a token.
 */
function corsHeaders(
	req: http.IncomingMessage,
	options: ResolvedHttpTransportOptions,
): CorsHeaders {
	if (options.allowedOrigins.includes("*")) {
		return { "Access-Control-Allow-Origin": "*" };
	}
	const origin = req.headers.origin;
	if (origin !== undefined && options.allowedOrigins.includes(origin)) {
		return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
	}
	return { Vary: "Origin" };
}

function sendCorsPreflight(res: http.ServerResponse, cors: CorsHeaders): void {
	res.writeHead(204, {
		...cors,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
		"Access-Control-Max-Age": "86400",
	});
	res.end();
}

/** 401 carries CORS headers so a browser reads the status instead of an opaque failure. */
function sendUnauthorized(res: http.ServerResponse, cors: CorsHeaders): void {
	if (res.headersSent) {
		return;
	}
	res.writeHead(401, {
		"Content-Type": "application/json",
		"WWW-Authenticate": "Bearer",
		...cors,
	});
	res.end(serializeJSON({ error: { message: "Unauthorized" } }));
}

function sendJson(
	res: http.ServerResponse,
	statusCode: number,
	body: HttpResponseBody,
	cors: CorsHeaders,
): void {
	if (res.headersSent) {
		return;
	}
	res.writeHead(statusCode, {
		"Content-Type": "application/json",
		...cors,
	});
	res.end(serializeJSON(body));
}

function handleStateRequest(res: http.ServerResponse, deps: RequestDeps, cors: CorsHeaders): void {
	if (!deps.options.exposeState) {
		sendJson(res, 404, { error: { message: "Not found: GET /state" } }, cors);
		return;
	}
	sendJson(res, 200, deps.ctx.getGlobalState(), cors);
}

// ---- SSE stream ----

function handleEventStream(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	deps: RequestDeps,
	cors: CorsHeaders,
): void {
	if (deps.clients.size >= deps.options.maxClients) {
		sendJson(res, 503, { error: { message: "Too many SSE clients" } }, cors);
		return;
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-store",
		...cors,
	});
	res.write("retry: 2000\n\n");

	deps.clients.add(res);
	req.on("close", () => {
		deps.clients.remove(res);
	});

	// Replay the last frame of every `replayEvents` entry seen so far, oldest
	// emission first, so a client that connects between emissions still learns
	// the current state.
	deps.clients.send(res, ...deps.replayFrames.values());
}

// ---- POST /command ----

const commandBodySchema = z.looseObject({ type: z.string() });

type BodyReadResult =
	| { status: "ok"; body: string }
	| { status: "too-large" }
	| { status: "error" };

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<BodyReadResult> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		let settled = false;

		const settle = (result: BodyReadResult) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(result);
		};

		req.on("data", (chunk: Buffer) => {
			if (settled) {
				return;
			}
			totalBytes += chunk.length;
			if (totalBytes > maxBytes) {
				settle({ status: "too-large" });
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => settle({ status: "ok", body: Buffer.concat(chunks).toString("utf8") }));
		req.on("error", () => settle({ status: "error" }));
	});
}

function parseCommandBody(body: string): BaseCommand | undefined {
	try {
		const parsed = commandBodySchema.safeParse(JSON.parse(body));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

async function handleCommandRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	deps: RequestDeps,
	cors: CorsHeaders,
	outcome: AuthOutcome,
): Promise<void> {
	const bodyRead = await readRequestBody(req, MAX_COMMAND_BODY_BYTES);
	if (bodyRead.status === "too-large") {
		sendJson(res, 413, { error: { message: "Request body exceeds 64KB limit" } }, cors);
		return;
	}
	if (bodyRead.status === "error") {
		sendJson(res, 400, { error: { message: "Failed to read request body" } }, cors);
		return;
	}

	const command = parseCommandBody(bodyRead.body);
	if (command === undefined) {
		sendJson(
			res,
			400,
			{ error: { message: 'Request body must be JSON with a string "type"' } },
			cors,
		);
		return;
	}
	// Two gates in order, and the transport-wide one runs first: role globs
	// intersect with `allowedCommands`, so a misconfigured role can never grant
	// more than the transport already offers.
	if (!deps.isCommandAllowed(command.type)) {
		sendJson(res, 403, { error: { message: `Command not allowed: ${command.type}` } }, cors);
		return;
	}
	if (
		outcome.status === "authenticated" &&
		!deps.auth.isCommandAllowed(outcome.principal, command.type)
	) {
		sendJson(
			res,
			403,
			{
				error: {
					message: `Command not permitted for role "${outcome.principal.role}": ${command.type}`,
				},
			},
			cors,
		);
		return;
	}

	await deps.ctx.dispatchCommand(command).match(
		(result) => sendJson(res, 200, { result: result ?? null }, cors),
		(error) => sendJson(res, 500, { error }, cors),
	);
}
