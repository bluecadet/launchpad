import http from "node:http";
import net from "node:net";
import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { BaseCommand, PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSseEvent, httpTransport } from "../http-transport.js";

const MANIFEST_VERSION_ID = "version-42";
const MANIFEST_RESULT = {
	status: "ok" as const,
	manifest: {
		versionId: MANIFEST_VERSION_ID,
		versionPath: "/versions/version-42",
		generatedAt: "2024-01-01T00:00:00.000Z",
	},
};

/** dispatchCommand stub: manifest read + ack succeed, anything else fails. */
function createDispatchCommand() {
	return vi.fn((command: BaseCommand): ResultAsync<unknown, Error> => {
		switch (command.type) {
			case "content.manifest.read":
				return okAsync(MANIFEST_RESULT);
			case "content.ack":
				return okAsync({ status: "ok" });
			default:
				return errAsync(
					new Error(`Unknown command: ${command.type}`, { cause: new Error("no such handler") }),
				);
		}
	});
}

function createTestCtx(overrides?: Partial<PluginContext>) {
	return createMockPluginCtx("/", {
		mode: "persistent",
		dispatchCommand: createDispatchCommand(),
		...overrides,
	});
}

type TestCtx = ReturnType<typeof createTestCtx>;

/**
 * Emit an arbitrary event name/payload on the mock bus. `AllEvents` only
 * covers events the controller knows about at compile time; tests need to
 * simulate plugin-defined events (e.g. `content:foo`) that aren't part of
 * that union, so the cast is necessary here.
 */
function emitBusEvent(ctx: TestCtx, event: string, data: unknown) {
	(ctx.eventBus.emit as (event: string, data: unknown) => boolean)(event, data);
}

/** Boot the transport on an ephemeral port and resolve its base URL. */
async function startHttpTransport(
	overrides: Partial<Parameters<typeof httpTransport>[0]> = {},
	ctx: TestCtx = createTestCtx(),
) {
	const transport = httpTransport({ port: 0, ...overrides });

	const result = await transport.setup(ctx);
	if (result.isErr()) {
		return { ctx, result, baseUrl: undefined };
	}
	const { address } = result.value;
	if (address === null) {
		throw new Error("HTTP transport reported success but never listened");
	}

	return { ctx, result, baseUrl: `http://127.0.0.1:${address.port}` };
}

type SseReader = ReadableStreamDefaultReader<Uint8Array>;

// One reader per response, so repeated readSseFrames() calls on the same
// response resume from where the last call left off instead of re-locking
// (and erroring on) the stream.
const readersByResponse = new WeakMap<
	Response,
	{ reader: SseReader; decoder: TextDecoder; buffer: string }
>();

function getSseReaderState(response: Response) {
	const existing = readersByResponse.get(response);
	if (existing) {
		return existing;
	}
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("Response has no readable body");
	}
	const state = { reader, decoder: new TextDecoder(), buffer: "" };
	readersByResponse.set(response, state);
	return state;
}

/** Read SSE frames (chunks separated by a blank line) off a fetch response. */
async function readSseFrames(response: Response, frameCount: number, timeoutMs = 2000) {
	const state = getSseReaderState(response);
	const frames: string[] = [];

	const timer = setTimeout(() => void state.reader.cancel(), timeoutMs);
	try {
		while (frames.length < frameCount) {
			const { value, done } = await state.reader.read();
			if (done) {
				break;
			}
			state.buffer += state.decoder.decode(value, { stream: true });

			let boundary = state.buffer.indexOf("\n\n");
			while (boundary !== -1 && frames.length < frameCount) {
				frames.push(state.buffer.slice(0, boundary));
				state.buffer = state.buffer.slice(boundary + 2);
				boundary = state.buffer.indexOf("\n\n");
			}
		}
	} finally {
		clearTimeout(timer);
	}
	return frames;
}

/** Read the raw "done" result off a response's SSE reader (no frame parsing). */
async function readSseStreamEnd(response: Response) {
	const state = getSseReaderState(response);
	if (state.buffer.length > 0) {
		return { done: false } as const;
	}
	return state.reader.read();
}

const activeHandles: Array<{
	disconnect: (reason: { type: "manual" }) => ResultAsync<void, Error>;
}> = [];

async function trackedStart(
	overrides: Partial<Parameters<typeof httpTransport>[0]> = {},
	ctx?: TestCtx,
) {
	const started = await startHttpTransport(overrides, ctx);
	if (started.result.isOk() && started.result.value.disconnect) {
		activeHandles.push({ disconnect: started.result.value.disconnect });
	}
	return started;
}

afterEach(async () => {
	while (activeHandles.length > 0) {
		const handle = activeHandles.pop();
		await handle?.disconnect({ type: "manual" });
	}
	vi.restoreAllMocks();
});

describe("formatSseEvent", () => {
	it("frames single-line data with event and data fields", () => {
		expect(formatSseEvent("content:foo", "hello")).toBe("event: content:foo\ndata: hello\n\n");
	});

	it("frames multi-line data as one data: line per line", () => {
		expect(formatSseEvent("content:foo", "line1\nline2")).toBe(
			"event: content:foo\ndata: line1\ndata: line2\n\n",
		);
	});
});

/**
 * Write a raw HTTP request over a plain TCP socket and resolve with everything
 * the server sent back. The request must ask for `Connection: close` so the
 * server ends the socket once the response is flushed — that end is the signal
 * we wait on, rather than a timer.
 */
function sendRawRequest(port: number, rawRequest: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket: net.Socket = net.connect(port, "127.0.0.1", () => {
			socket.write(rawRequest);
		});
		let received = "";
		socket.on("data", (chunk: Buffer) => {
			received += chunk.toString("utf8");
		});
		socket.on("error", reject);
		socket.on("close", () => resolve(received));
	});
}

describe("http-transport", () => {
	describe("SSE connect", () => {
		it("sends the retry directive first, with nothing to replay on a fresh transport", async () => {
			const { ctx, baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/events`);
			expect(response.status).toBe(200);

			const [retryFrame] = await readSseFrames(response, 1);
			expect(retryFrame).toBe("retry: 2000");

			// The next frame is a live event, so nothing was replayed before it.
			emitBusEvent(ctx, "content:foo", { live: true });
			const [nextFrame] = await readSseFrames(response, 1);
			expect(nextFrame).toContain("event: content:foo");
		});
	});

	describe("replay on connect", () => {
		it("replays an event emitted before the client connected", async () => {
			const { ctx, baseUrl } = await trackedStart();

			emitBusEvent(ctx, "content:version:promoted", { versionId: MANIFEST_VERSION_ID });

			const response = await fetch(`${baseUrl}/events`);
			const [retryFrame, replayFrame] = await readSseFrames(response, 2);

			expect(retryFrame).toBe("retry: 2000");
			expect(replayFrame).toContain("event: content:version:promoted");
			expect(replayFrame).toContain(MANIFEST_VERSION_ID);
		});

		it("replays the last frame of each distinct replayable event once", async () => {
			const { ctx, baseUrl } = await trackedStart({
				replayEvents: ["content:foo", "content:bar"],
			});

			emitBusEvent(ctx, "content:foo", { which: "foo" });
			emitBusEvent(ctx, "content:bar", { which: "bar" });

			const response = await fetch(`${baseUrl}/events`);
			const [, firstReplay, secondReplay] = await readSseFrames(response, 3);

			expect(firstReplay).toContain("event: content:foo");
			expect(secondReplay).toContain("event: content:bar");
		});

		it("replays only the latest frame when an event is emitted twice", async () => {
			const { ctx, baseUrl } = await trackedStart({ replayEvents: ["content:foo"] });

			emitBusEvent(ctx, "content:foo", { revision: 1 });
			emitBusEvent(ctx, "content:foo", { revision: 2 });

			const response = await fetch(`${baseUrl}/events`);
			const [, replayFrame] = await readSseFrames(response, 2);
			expect(replayFrame).toContain('"revision":2');

			// Only one frame was replayed: the next one is the live event.
			emitBusEvent(ctx, "content:bar", { live: true });
			const [nextFrame] = await readSseFrames(response, 1);
			expect(nextFrame).toContain("event: content:bar");
		});

		it("orders the backlog by last emission, not first", async () => {
			const { ctx, baseUrl } = await trackedStart({
				replayEvents: ["content:foo", "content:bar"],
			});

			emitBusEvent(ctx, "content:foo", { round: 1 });
			emitBusEvent(ctx, "content:bar", { round: 1 });
			// Re-emitting foo must move it behind bar, so the backlog stays
			// chronologically coherent.
			emitBusEvent(ctx, "content:foo", { round: 2 });

			const response = await fetch(`${baseUrl}/events`);
			const [, firstReplay, secondReplay] = await readSseFrames(response, 3);

			expect(firstReplay).toContain("event: content:bar");
			expect(secondReplay).toContain("event: content:foo");
			expect(secondReplay).toContain('"round":2');
		});

		it("streams an event that is not in replayEvents live but never replays it", async () => {
			const { ctx, baseUrl } = await trackedStart({ replayEvents: ["content:version:promoted"] });

			emitBusEvent(ctx, "content:foo", { stale: true });

			const response = await fetch(`${baseUrl}/events`);
			const [retryFrame] = await readSseFrames(response, 1);
			expect(retryFrame).toBe("retry: 2000");

			// Nothing was replayed, but the same event still streams live.
			emitBusEvent(ctx, "content:foo", { live: true });
			const [nextFrame] = await readSseFrames(response, 1);
			expect(nextFrame).toContain("event: content:foo");
			expect(nextFrame).toContain('"live":true');
		});

		it("never replays an event that the filter dropped", async () => {
			const { ctx, baseUrl } = await trackedStart({ replayEvents: ["monitor:bar"] });

			emitBusEvent(ctx, "monitor:bar", { ignored: true });

			const response = await fetch(`${baseUrl}/events`);
			const [retryFrame] = await readSseFrames(response, 1);
			expect(retryFrame).toBe("retry: 2000");

			emitBusEvent(ctx, "content:foo", { live: true });
			const [nextFrame] = await readSseFrames(response, 1);
			expect(nextFrame).toContain("event: content:foo");
		});
	});

	describe("event filter", () => {
		it("delivers events matching the default content:* filter and drops others", async () => {
			const { ctx, baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/events`);
			// Skip the retry frame.
			await readSseFrames(response, 1);

			emitBusEvent(ctx, "monitor:bar", { ignored: true });
			emitBusEvent(ctx, "content:foo", { hello: "world" });

			const [deliveredFrame] = await readSseFrames(response, 1);
			expect(deliveredFrame).toContain("event: content:foo");
			expect(deliveredFrame).toContain("world");
			expect(deliveredFrame).not.toContain("monitor:bar");
		});

		it("delivers every event when configured with a wildcard filter", async () => {
			const { ctx, baseUrl } = await trackedStart({ events: ["*"] });

			const response = await fetch(`${baseUrl}/events`);
			await readSseFrames(response, 1);

			emitBusEvent(ctx, "monitor:bar", { seen: true });

			const [deliveredFrame] = await readSseFrames(response, 1);
			expect(deliveredFrame).toContain("event: monitor:bar");
		});
	});

	describe("keep-alive", () => {
		it("writes a ping comment on the configured interval", async () => {
			const { baseUrl } = await trackedStart({ keepAliveMs: 30 });

			const response = await fetch(`${baseUrl}/events`);
			await readSseFrames(response, 1); // retry

			const [pingFrame] = await readSseFrames(response, 1);
			expect(pingFrame).toBe(": ping");
		});
	});

	describe("maxClients", () => {
		it("rejects a second connection with 503 once the limit is reached", async () => {
			const { baseUrl } = await trackedStart({ maxClients: 1 });

			const first = await fetch(`${baseUrl}/events`);
			expect(first.status).toBe(200);
			// Drain the initial frame so the connection is established server-side.
			await readSseFrames(first, 1);

			const second = await fetch(`${baseUrl}/events`);
			expect(second.status).toBe(503);
			const body = (await second.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Too many SSE clients");
		});
	});

	describe("POST /command", () => {
		it("returns 200 with the result for an allowlisted command", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { result: unknown };
			expect(body.result).toEqual({ status: "ok" });
		});

		it("returns 403 for a command not in the allowlist", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "system:shutdown" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Command not allowed");
		});

		it("returns 500 with the error name, message and cause chain when dispatch fails", async () => {
			const { baseUrl } = await trackedStart({
				allowedCommands: ["content.ack", "content.manifest.read", "content.explode"],
			});

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.explode" }),
			});

			expect(response.status).toBe(500);
			const body = (await response.json()) as {
				error: { name: string; message: string; cause: { message: string } };
			};
			expect(body.error.name).toBe("Error");
			expect(body.error.message).toContain("Unknown command: content.explode");
			expect(body.error.cause.message).toBe("no such handler");
		});

		it("returns 400 for a malformed JSON body", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: "{ not json",
			});

			expect(response.status).toBe(400);
		});
	});

	describe("GET /status and /state", () => {
		it("returns the status snapshot", async () => {
			const snapshot = {
				header: { startTime: new Date(0).toISOString(), uptimeMs: 0, mode: "persistent" as const },
				sections: [],
			};
			const ctx = createTestCtx({ getStatusSnapshot: vi.fn().mockReturnValue(snapshot) });

			const { baseUrl } = await trackedStart({}, ctx);

			const response = await fetch(`${baseUrl}/status`);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(snapshot);
		});

		it("returns 404 for /state by default", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/state`);
			expect(response.status).toBe(404);
		});

		it("returns the global state at /state when exposeState is set", async () => {
			const state = { system: { mode: "persistent" }, plugins: {}, _version: 3 };
			const ctx = createTestCtx({ getGlobalState: vi.fn().mockReturnValue(state) });

			const { baseUrl } = await trackedStart({ exposeState: true }, ctx);

			const response = await fetch(`${baseUrl}/state`);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(state);
		});
	});

	describe("CORS", () => {
		it("responds to OPTIONS with 204 and preflight headers", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/events`, { method: "OPTIONS" });

			expect(response.status).toBe(204);
			expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
			expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
			expect(response.headers.get("access-control-max-age")).toBe("86400");
		});

		it("sets Access-Control-Allow-Origin: * on every response", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/status`);
			expect(response.headers.get("access-control-allow-origin")).toBe("*");
		});
	});

	describe("malformed request target", () => {
		it("responds 400 instead of crashing, and keeps serving later requests", async () => {
			const { baseUrl } = await trackedStart();
			if (baseUrl === undefined) {
				throw new Error("HTTP transport started without a base URL");
			}
			const port = Number(new URL(baseUrl).port);

			const rawResponse = await sendRawRequest(
				port,
				"GET http://[::1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
			);
			expect(rawResponse).toContain("400");

			// The daemon must still be alive and answering ordinary requests.
			const followUp = await fetch(`${baseUrl}/status`);
			expect(followUp.status).toBe(200);
		});
	});

	describe("unknown routes", () => {
		it("returns a 404 JSON error", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/nope`);
			expect(response.status).toBe(404);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Not found: GET /nope");
		});
	});

	describe("task mode", () => {
		it("succeeds without binding a port and exposes no address", async () => {
			const ctx = createTestCtx({ mode: "task" });

			const transport = httpTransport({ port: 0 });

			const result = await transport.setup(ctx);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap().address).toBeNull();
		});

		it("still fails setup on invalid options", async () => {
			const ctx = createTestCtx({ mode: "task" });

			const transport = httpTransport({ port: 999999 });

			const result = await transport.setup(ctx);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("port conflict", () => {
		it("fails setup with an err Result when the port is already bound", async () => {
			const blocker = http.createServer();
			await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
			const blockedPort = (blocker.address() as net.AddressInfo).port;

			try {
				const { result } = await startHttpTransport({ port: blockedPort });
				expect(result.isErr()).toBe(true);
			} finally {
				await new Promise<void>((resolve) => blocker.close(() => resolve()));
			}
		});
	});

	describe("disconnect", () => {
		it("ends open SSE streams and frees the port for reuse", async () => {
			const started = await startHttpTransport();
			const { baseUrl } = started;
			if (baseUrl === undefined) {
				throw new Error("HTTP transport started without a base URL");
			}
			const handle = started.result._unsafeUnwrap();

			const response = await fetch(`${baseUrl}/events`);
			// Drain the initial retry frame before disconnecting, so the next read
			// reflects the stream closing rather than backlog.
			await readSseFrames(response, 1);

			const boundPort = Number(new URL(baseUrl).port);

			const disconnectResult = await handle.disconnect?.({ type: "manual" });
			expect(disconnectResult?.isOk()).toBe(true);

			const readAfterClose = await readSseStreamEnd(response);
			expect(readAfterClose.done).toBe(true);

			// The port should be free again.
			const rebound = await startHttpTransport({ port: boundPort });
			expect(rebound.result.isOk()).toBe(true);
			await rebound.result._unsafeUnwrap().disconnect?.({ type: "manual" });
		});
	});
});
