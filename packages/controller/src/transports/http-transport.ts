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
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import {
	type BaseCommand,
	type Disconnectable,
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import type { AllEvents } from "../all-events.js";
import { TransportError } from "../errors.js";
import { serializeJSON } from "../utils/json-serializer.js";

const MAX_COMMAND_BODY_BYTES = 64 * 1024;
const PROMOTED_EVENT = "content:version:promoted";

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
	/** Interval between `: ping` SSE comment lines. */
	keepAliveMs: z.number().int().positive().default(15000),
	/** Maximum concurrent SSE clients; further `GET /events` requests get a 503. */
	maxClients: z.number().int().positive().default(32),
	/** Expose the full global state at `GET /state`. Off by default. */
	exposeState: z.boolean().default(false),
	/** Test hook invoked with the bound address once the server is listening. */
	onListening: z
		.custom<(address: AddressInfo) => void>((value) => typeof value === "function")
		.optional(),
});

export type HttpTransportOptions = z.input<typeof httpTransportOptionsSchema>;

type ResolvedHttpTransportOptions = z.output<typeof httpTransportOptionsSchema>;

/**
 * Build a single SSE frame. Multi-line data is framed with one `data:` field
 * per line, per the SSE spec, so payloads survive EventSource reassembly.
 */
export function formatSseEvent(name: string, data: string, id?: string): string {
	const lines = [`event: ${name}`];
	if (id !== undefined) {
		lines.push(`id: ${id}`);
	}
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
		setup(ctx): ResultAsync<Partial<Disconnectable>, TransportError> {
			const parsedOptions = httpTransportOptionsSchema.safeParse(options);
			if (!parsedOptions.success) {
				return errAsync(
					new TransportError(`Invalid HTTP transport options: ${parsedOptions.error.message}`),
				);
			}
			const resolvedOptions = parsedOptions.data;

			if (ctx.mode === "task") {
				ctx.logger.verbose("HTTP transport inactive in task mode");
				return okAsync({});
			}

			const sseClients = new Set<http.ServerResponse>();
			const shutdownState = { isDisconnecting: false };
			const deps: RequestDeps = {
				ctx,
				options: resolvedOptions,
				sseClients,
				passesEventFilter: createEventFilter(resolvedOptions.events),
				isShuttingDown: () => shutdownState.isDisconnecting,
			};

			const server = http.createServer((req, res) => handleRequest(req, res, deps));

			return safeListen(server, resolvedOptions).map((address) => {
				ctx.logger.info(`HTTP transport listening on http://${address.address}:${address.port}`);

				// Post-listen socket errors must not crash the process.
				server.on("error", (error) => {
					ctx.logger.error(`HTTP transport server error: ${error.message}`);
				});

				const handleBusEvent = <K extends keyof AllEvents>(event: K, data: AllEvents[K]) => {
					if (!deps.passesEventFilter(event)) {
						return;
					}
					const frame = formatSseEvent(event, serializeJSON(data));
					sseClients.forEach((client) => writeToSseClient(client, frame, ctx.logger));
				};
				ctx.eventBus.onAny(handleBusEvent);

				const keepAliveTimer = setInterval(() => {
					sseClients.forEach((client) => writeToSseClient(client, ": ping\n\n", ctx.logger));
				}, resolvedOptions.keepAliveMs);

				const disconnect = (_reason: DisconnectReason): ResultAsync<void, Error> => {
					if (shutdownState.isDisconnecting) {
						return okAsync(undefined);
					}

					shutdownState.isDisconnecting = true;
					ctx.logger.verbose("HTTP transport is shutting down");
					ctx.eventBus.offAny(handleBusEvent);
					clearInterval(keepAliveTimer);
					sseClients.forEach((client) => client.end());
					sseClients.clear();
					server.closeIdleConnections();

					return ResultAsync.fromPromise(
						new Promise<void>((resolve) => {
							server.close(() => {
								ctx.logger.info("HTTP transport closed");
								resolve();
							});
						}),
						(error) =>
							new TransportError("Failed to close HTTP server", { cause: ensureError(error) }),
					);
				};

				ctx.abortSignal.addEventListener("abort", () => void disconnect({ type: "manual" }), {
					once: true,
				});

				resolvedOptions.onListening?.(address);
				return { disconnect };
			});
		},
	});
}

type RequestDeps = {
	ctx: PluginContext;
	options: ResolvedHttpTransportOptions;
	sseClients: Set<http.ServerResponse>;
	passesEventFilter: (eventName: string) => boolean;
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

/**
 * listen() wrapped so any bind error (e.g. EADDRINUSE) surfaces as an err
 * Result and fails plugin setup.
 */
function safeListen(
	server: http.Server,
	options: { port: number; host: string },
): ResultAsync<AddressInfo, TransportError> {
	return ResultAsync.fromPromise(
		new Promise<AddressInfo>((resolve, reject) => {
			const handleError = (error: Error) => {
				server.removeListener("listening", handleListening);
				reject(error);
			};
			const handleListening = () => {
				server.removeListener("error", handleError);
				const address = server.address();
				if (address === null || typeof address === "string") {
					reject(new Error("HTTP server reported a non-TCP address"));
					return;
				}
				resolve(address);
			};

			server.once("error", handleError);
			server.once("listening", handleListening);
			server.listen(options.port, options.host);
		}),
		(error) =>
			new TransportError("Failed to start HTTP transport server", { cause: ensureError(error) }),
	);
}

// ---- Request routing ----

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
			sendReadJson(res, () => deps.ctx.getStatusSnapshot(), deps.ctx.logger);
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

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
	if (res.headersSent) {
		return;
	}
	res.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(serializeJSON(body));
}

/** Send the result of a synchronous read as JSON, mapping a throw to a 500. */
function sendReadJson(
	res: http.ServerResponse,
	read: () => unknown,
	logger: PluginContext["logger"],
): void {
	try {
		sendJson(res, 200, read());
	} catch (e) {
		logger.error(`Failed to read state for HTTP response: ${ensureError(e).message}`);
		sendJson(res, 500, { error: { message: "Failed to read state" } });
	}
}

function handleStateRequest(res: http.ServerResponse, deps: RequestDeps): void {
	if (!deps.options.exposeState) {
		sendJson(res, 404, { error: { message: "Not found: GET /state" } });
		return;
	}
	sendReadJson(res, () => deps.ctx.getGlobalState(), deps.ctx.logger);
}

// ---- SSE stream ----

function handleEventStream(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	deps: RequestDeps,
): void {
	if (deps.isShuttingDown()) {
		sendJson(res, 503, { error: { message: "HTTP transport is shutting down" } });
		return;
	}

	if (deps.sseClients.size >= deps.options.maxClients) {
		sendJson(res, 503, { error: { message: "Too many SSE clients" } });
		return;
	}

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-store",
		"Access-Control-Allow-Origin": "*",
	});
	res.write("retry: 2000\n\n");

	deps.sseClients.add(res);
	req.on("close", () => {
		deps.sseClients.delete(res);
	});

	sendCatchUpEvent(res, deps);
}

/** The slice of a `content.manifest.read` result the catch-up event needs. */
const promotedManifestResultSchema = z.object({
	status: z.literal("ok"),
	manifest: z.object({
		versionId: z.string(),
		versionPath: z.string(),
		generatedAt: z.string(),
	}),
});

/**
 * Emit a synthetic `content:version:promoted` event to a newly connected
 * client so it learns the active version without waiting for the next promote.
 * Best-effort: skipped silently when the event is filtered out, the command
 * isn't registered, or the manifest isn't readable.
 */
function sendCatchUpEvent(res: http.ServerResponse, deps: RequestDeps): void {
	if (!deps.passesEventFilter(PROMOTED_EVENT)) {
		return;
	}

	deps.ctx.dispatchCommand({ type: "content.manifest.read" }).match(
		(result) => {
			const parsed = promotedManifestResultSchema.safeParse(result);
			if (!parsed.success) {
				return;
			}
			const { versionId, versionPath, generatedAt } = parsed.data.manifest;
			const payload = serializeJSON({ versionId, versionPath, generatedAt });
			writeToSseClient(res, formatSseEvent(PROMOTED_EVENT, payload, versionId), deps.ctx.logger);
		},
		() => {
			// Catch-up is best-effort; a missing command or manifest is not an error.
		},
	);
}

/**
 * Fire-and-forget SSE write. No backpressure handling: if the client's buffer
 * is full the data is queued or dropped by the socket, and slow clients may
 * miss events. Accepted limitation — the manifest poll contract stays
 * authoritative.
 */
function writeToSseClient(
	client: http.ServerResponse,
	frame: string,
	logger: PluginContext["logger"],
): void {
	if (client.writableEnded) {
		return;
	}
	try {
		client.write(frame);
	} catch (e) {
		logger.verbose(`Failed to write to SSE client: ${ensureError(e).message}`);
	}
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
		(error) => sendJson(res, 500, { error: { name: error.name, message: error.message } }),
	);
}
