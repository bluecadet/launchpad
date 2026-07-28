/**
 * HTTP/SSE Transport for non-Node consumers (browsers, Unity, etc.).
 *
 * Exposes a small HTTP surface on localhost:
 * - `GET /events`  — Server-Sent Events stream of bus events (filtered)
 * - `POST /command` — dispatch an allowlisted command
 * - `GET /status`  — display-oriented status snapshot
 * - `GET /state`   — full global state (opt-in via `exposeState`)
 *
 * Push is best-effort sugar on top of the authoritative `manifest.json` poll
 * contract. Known limitations (accepted by design):
 * - SSE writes are fire-and-forget with no backpressure handling; slow clients
 *   may silently miss events.
 * - A failed port bind (e.g. EADDRINUSE) is a hard setup failure with no
 *   auto-recovery.
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
import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from "neverthrow";
import { z } from "zod";
import type { AllEvents } from "../all-events.js";
import { TransportError } from "../errors.js";
import { serializeJSON } from "../utils/json-serializer.js";
import { type ClientHub, createClientHub } from "./client-hub.js";
import { closeServerAsResult, createShutdownGate, listenAsResult } from "./server-lifecycle.js";

const MAX_COMMAND_BODY_BYTES = 64 * 1024;

const httpTransportOptionsSchema = z.object({
	/** Port to listen on. `0` picks a random free port (useful for tests). */
	port: z.number().int().min(0).max(65535).default(8710),
	/** Host/interface to bind. */
	host: z.string().default("127.0.0.1"),
	/** Command types accepted by `POST /command`. Anything else gets a 403. */
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
});

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
 */
export function formatSseEvent(name: string, data: string): string {
	const lines = [`event: ${name}`];
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

			if (ctx.mode === "task") {
				ctx.logger.verbose("HTTP transport inactive in task mode");
				return okAsync({ address: null });
			}

			const clients = createSseClientHub(ctx.logger);
			// Last frame seen per replayable event name, replayed to each new client
			// so it doesn't have to wait for the next emission to learn current
			// state. Insertion order is kept as last-emission order (see below), so
			// the backlog reads as a chronologically coherent history.
			const replayFrames = new Map<string, string>();
			const replayableEvents = new Set<string>(resolvedOptions.replayEvents);
			const passesEventFilter = createEventFilter(resolvedOptions.events);

			const handleBusEvent = <K extends keyof AllEvents>(event: K, data: AllEvents[K]) => {
				if (!passesEventFilter(event)) {
					return;
				}
				const frame = formatSseEvent(event, serializeJSON(data));
				if (replayableEvents.has(event)) {
					// `Map.set` on an existing key keeps its original position, so drop
					// the old entry first to move the event to the back of the backlog.
					replayFrames.delete(event);
					replayFrames.set(event, frame);
				}
				clients.broadcast(frame);
			};
			let keepAliveTimer: NodeJS.Timeout | undefined;

			const server = http.createServer((req, res) => handleRequest(req, res, deps));
			const gate = createShutdownGate(() => {
				ctx.logger.verbose("HTTP transport is shutting down");
				ctx.eventBus.offAny(handleBusEvent);
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
};

function createEventFilter(patterns: readonly string[]): (eventName: string) => boolean {
	return (eventName) =>
		patterns.some((pattern) => {
			if (pattern.endsWith("*")) {
				return eventName.startsWith(pattern.slice(0, -1));
			}
			return eventName === pattern;
		});
}

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

function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	deps: RequestDeps,
): void {
	if (deps.isShuttingDown()) {
		sendJson(res, 503, { error: { message: "HTTP transport is shutting down" } });
		return;
	}

	const method = req.method ?? "GET";
	if (method === "OPTIONS") {
		sendCorsPreflight(res);
		return;
	}

	let url: URL;
	try {
		url = new URL(req.url ?? "/", "http://local");
	} catch {
		sendJson(res, 400, { error: { message: `Invalid request target: ${req.url}` } });
		return;
	}

	switch (`${method} ${url.pathname}`) {
		case "GET /events":
			handleEventStream(req, res, deps);
			return;
		case "POST /command":
			void handleCommandRequest(req, res, deps);
			return;
		case "GET /status":
			sendJson(res, 200, deps.ctx.getStatusSnapshot());
			return;
		case "GET /state":
			handleStateRequest(res, deps);
			return;
		default:
			sendJson(res, 404, { error: { message: `Not found: ${method} ${url.pathname}` } });
	}
}

function sendCorsPreflight(res: http.ServerResponse): void {
	res.writeHead(204, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
	});
	res.end();
}

function sendJson(res: http.ServerResponse, statusCode: number, body: HttpResponseBody): void {
	if (res.headersSent) {
		return;
	}
	res.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(serializeJSON(body));
}

function handleStateRequest(res: http.ServerResponse, deps: RequestDeps): void {
	if (!deps.options.exposeState) {
		sendJson(res, 404, { error: { message: "Not found: GET /state" } });
		return;
	}
	sendJson(res, 200, deps.ctx.getGlobalState());
}

// ---- SSE stream ----

function handleEventStream(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	deps: RequestDeps,
): void {
	if (deps.clients.size >= deps.options.maxClients) {
		sendJson(res, 503, { error: { message: "Too many SSE clients" } });
		return;
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-store",
		"Access-Control-Allow-Origin": "*",
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
): Promise<void> {
	const bodyRead = await readRequestBody(req, MAX_COMMAND_BODY_BYTES);
	if (bodyRead.status === "too-large") {
		sendJson(res, 413, { error: { message: "Request body exceeds 64KB limit" } });
		return;
	}
	if (bodyRead.status === "error") {
		sendJson(res, 400, { error: { message: "Failed to read request body" } });
		return;
	}

	const command = parseCommandBody(bodyRead.body);
	if (command === undefined) {
		sendJson(res, 400, { error: { message: 'Request body must be JSON with a string "type"' } });
		return;
	}
	if (!deps.options.allowedCommands.includes(command.type)) {
		sendJson(res, 403, { error: { message: `Command not allowed: ${command.type}` } });
		return;
	}

	await deps.ctx.dispatchCommand(command).match(
		(result) => sendJson(res, 200, { result }),
		(error) => sendJson(res, 500, { error }),
	);
}
