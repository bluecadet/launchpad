import http from "node:http";
import net from "node:net";
import {
	createMockPluginCtx,
	createMockStatePatchSource,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import type { BaseCommand, PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { NodeIdentity, StatusSnapshot } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandExecutionError } from "../../errors.js";
import { serializeJSON } from "../../utils/json-serializer.js";
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

/** Every failure the real dispatcher can produce, one per reason. */
const DISPATCH_FAILURES = {
	"content.explode": new CommandExecutionError("Plugin command execution failed", {
		reason: "handler-failed",
		commandType: "content.explode",
		cause: new Error("no such handler"),
	}),
	"content.ack.bad": new CommandExecutionError("Invalid command: content.ack", {
		reason: "invalid",
		commandType: "content.ack",
		cause: new Error("consumerId is required"),
	}),
} as const;

/**
 * dispatchCommand stub: manifest read + ack succeed, the two commands above
 * fail their own way, and anything else is unregistered — exactly what the
 * real dispatcher answers for a command no plugin implements.
 */
function createDispatchCommand() {
	return vi.fn((command: BaseCommand): ResultAsync<unknown, CommandExecutionError> => {
		switch (command.type) {
			case "content.manifest.read":
				return okAsync(MANIFEST_RESULT);
			case "content.ack":
				return okAsync({ status: "ok" });
			default: {
				const failure = DISPATCH_FAILURES[command.type as keyof typeof DISPATCH_FAILURES];
				return errAsync(
					failure ??
						new CommandExecutionError(`Command '${command.type}' is not registered`, {
							reason: "not-registered",
							commandType: command.type,
						}),
				);
			}
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

type ParsedFrame = { id?: number; event?: string; data: string };

/** Split one raw SSE frame into its `id:` / `event:` / `data:` parts. */
function parseFrame(raw: string): ParsedFrame {
	const dataLines: string[] = [];
	const parsed: ParsedFrame = { data: "" };
	for (const line of raw.split("\n")) {
		if (line.startsWith("id: ")) {
			parsed.id = Number(line.slice("id: ".length));
		} else if (line.startsWith("event: ")) {
			parsed.event = line.slice("event: ".length);
		} else if (line.startsWith("data: ")) {
			dataLines.push(line.slice("data: ".length));
		}
	}
	parsed.data = dataLines.join("\n");
	return parsed;
}

/** Read `count` frames off a response and parse each one. */
async function readParsedFrames(response: Response, count: number) {
	return (await readSseFrames(response, count)).map(parseFrame);
}

/** Open an SSE stream and drain the `retry:` line so the client is registered. */
async function openEventStream(baseUrl: string) {
	const response = await fetch(`${baseUrl}/events`);
	await readSseFrames(response, 1);
	return response;
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
	vi.unstubAllEnvs();
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

	it("writes a sequence number as an id: field ahead of event:", () => {
		expect(formatSseEvent("content:foo", "hello", 7)).toBe(
			"id: 7\nevent: content:foo\ndata: hello\n\n",
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

const DOCENT_TOKEN = "docent-token-value-0123456789";
const KIOSK_TOKEN = "kiosk-token-value-0123456789";

const AUTH_OPTIONS = {
	roles: {
		docent: ["content.*"],
		kiosk: ["content.ack"],
	},
	tokens: {
		"docent-tablet": { env: "LAUNCHPAD_TOKEN_DOCENT", role: "docent" },
		"lobby-kiosk": { env: "LAUNCHPAD_TOKEN_KIOSK", role: "kiosk" },
	},
};

/**
 * `monitor.restart` is allowlisted transport-wide but sits outside both roles,
 * so it exercises the `allowedCommands` ∩ role-globs intersection.
 */
const AUTHED_TRANSPORT = {
	auth: AUTH_OPTIONS,
	allowedCommands: ["content.ack", "content.manifest.read", "monitor.restart"],
};

/** The registry snapshots the environment at setup, so stub before starting. */
function stubTokenEnv() {
	vi.stubEnv("LAUNCHPAD_TOKEN_DOCENT", DOCENT_TOKEN);
	vi.stubEnv("LAUNCHPAD_TOKEN_KIOSK", KIOSK_TOKEN);
}

function docentHeader() {
	return { authorization: `Bearer ${DOCENT_TOKEN}` };
}

function kioskHeader() {
	return { authorization: `Bearer ${KIOSK_TOKEN}` };
}

/** Flatten every argument the transport ever logged into one searchable string. */
function collectLoggedText(logger: TestCtx["logger"]): string {
	const mocks = [logger.debug, logger.info, logger.warn, logger.error, logger.verbose, logger.log];
	return mocks
		.flatMap((mock) => vi.mocked(mock).mock.calls)
		.flat()
		.map((argument) => JSON.stringify(argument))
		.join(" ");
}

/** Read frames until one is an actual SSE event frame, skipping `: ping` comments. */
async function readNextEventFrame(response: Response, maxFrames = 20) {
	for (let attempt = 0; attempt < maxFrames; attempt += 1) {
		const [raw] = await readSseFrames(response, 1);
		if (raw === undefined) {
			break;
		}
		if (raw.startsWith(":")) {
			continue;
		}
		return parseFrame(raw);
	}
	throw new Error("Stream ended before an event frame arrived");
}

/** Read the next `: ping` comment, skipping any event frames ahead of it. */
async function readNextPingFrame(response: Response, maxFrames = 20) {
	for (let attempt = 0; attempt < maxFrames; attempt += 1) {
		const [raw] = await readSseFrames(response, 1);
		if (raw === undefined) {
			break;
		}
		if (raw.startsWith(":")) {
			return raw;
		}
	}
	throw new Error("Stream ended before a keep-alive comment arrived");
}

/** A ctx whose `onGlobalStatePatch` can be driven from the test. */
function createPatchCtx() {
	const patchSource = createMockStatePatchSource();
	const onGlobalStatePatch = vi.fn(patchSource.onGlobalStatePatch);
	return { ctx: createTestCtx({ onGlobalStatePatch }), patchSource, onGlobalStatePatch };
}

const PUSH_STATE = { pushStatePatches: true, exposeState: true } as const;

function samplePatch(value: unknown) {
	return [{ op: "replace" as const, path: ["plugins", "content", "activeVersion"], value }];
}

function countWarnings(ctx: TestCtx, needle: string) {
	return vi
		.mocked(ctx.logger.warn)
		.mock.calls.filter(([message]) => String(message).includes(needle)).length;
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
			const { baseUrl } = await trackedStart({ allowedCommands: ["content.ack"] });

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { result: unknown };
			expect(body.result).toEqual({ status: "ok" });
		});

		it("returns 200 with a present, null result for a command that resolves nothing", async () => {
			const ctx = createTestCtx({ dispatchCommand: vi.fn(() => okAsync(undefined)) });
			const { baseUrl } = await trackedStart({ allowedCommands: ["content.ack"] }, ctx);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { result: unknown };
			expect("result" in body).toBe(true);
			expect(body.result).toBeNull();
		});

		it("returns 403 for any command when allowedCommands is left at its default", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Command not allowed");
		});

		it("returns 403 for a command not in the allowlist", async () => {
			const { baseUrl } = await trackedStart({ allowedCommands: ["content.ack"] });

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "system:shutdown" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Command not allowed");
		});

		it("returns 404 for a command this node does not implement", async () => {
			const { baseUrl } = await trackedStart({
				allowedCommands: ["content.ack", "content.manifest.read", "content.nope"],
			});

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.nope" }),
			});

			expect(response.status).toBe(404);
			const body = (await response.json()) as {
				error: { name: string; message: string; reason: string; commandType: string };
			};
			expect(body.error.name).toBe("CommandExecutionError");
			expect(body.error.reason).toBe("not-registered");
			expect(body.error.commandType).toBe("content.nope");
			expect(body.error.message).toContain("is not registered");
			expect("cause" in body.error).toBe(false);
		});

		it("returns 400 when a command's own params fail its parser", async () => {
			const { baseUrl } = await trackedStart({
				allowedCommands: ["content.ack.bad"],
			});

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack.bad" }),
			});

			expect(response.status).toBe(400);
			const body = (await response.json()) as {
				error: { name: string; reason: string; commandType: string; cause: { message: string } };
			};
			expect(body.error.name).toBe("CommandExecutionError");
			expect(body.error.reason).toBe("invalid");
			expect(body.error.commandType).toBe("content.ack");
			expect(body.error.cause.message).toBe("consumerId is required");
		});

		it("returns 500 with the error name, message and cause chain when a handler fails", async () => {
			const { baseUrl } = await trackedStart({
				allowedCommands: ["content.ack", "content.manifest.read", "content.explode"],
			});

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.explode" }),
			});

			expect(response.status).toBe(500);
			const body = (await response.json()) as {
				error: { name: string; message: string; reason: string; cause: { message: string } };
			};
			expect(body.error.name).toBe("CommandExecutionError");
			expect(body.error.reason).toBe("handler-failed");
			expect(body.error.message).toContain("Plugin command execution failed");
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
		function makeSnapshot(node: NodeIdentity) {
			return {
				header: {
					startTime: new Date(0).toISOString(),
					uptimeMs: 0,
					mode: "persistent" as const,
					node,
				},
				sections: [],
			};
		}

		it("returns the status snapshot", async () => {
			const snapshot = makeSnapshot({ id: "kiosk-1", label: "Kiosk 1", role: "exhibit" });
			const ctx = createTestCtx({ getStatusSnapshot: vi.fn().mockReturnValue(snapshot) });

			const { baseUrl } = await trackedStart({}, ctx);

			const response = await fetch(`${baseUrl}/status`);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(snapshot);
		});

		it("carries the Node identity through JSON serialization", async () => {
			const node: NodeIdentity = { id: "kiosk-1", label: "Kiosk 1", role: "exhibit" };
			const ctx = createTestCtx({
				getStatusSnapshot: vi.fn().mockReturnValue(makeSnapshot(node)),
			});

			const { baseUrl } = await trackedStart({}, ctx);

			const body = (await (await fetch(`${baseUrl}/status`)).json()) as StatusSnapshot;
			expect(body.header.node).toEqual(node);
		});

		it("lets a client tell two Nodes apart from their own responses", async () => {
			const first = createTestCtx({
				getStatusSnapshot: vi.fn().mockReturnValue(makeSnapshot({ id: "kiosk-1", label: "1" })),
			});
			const second = createTestCtx({
				getStatusSnapshot: vi.fn().mockReturnValue(makeSnapshot({ id: "kiosk-2", label: "2" })),
			});

			const firstUrl = (await trackedStart({}, first)).baseUrl;
			const secondUrl = (await trackedStart({}, second)).baseUrl;

			const firstBody = (await (await fetch(`${firstUrl}/status`)).json()) as StatusSnapshot;
			const secondBody = (await (await fetch(`${secondUrl}/status`)).json()) as StatusSnapshot;

			expect(firstBody.header.node.id).toBe("kiosk-1");
			expect(secondBody.header.node.id).toBe("kiosk-2");
		});

		it("answers the liveness check with 200 when no tokens are configured", async () => {
			const { baseUrl } = await trackedStart();

			expect((await fetch(`${baseUrl}/status`)).status).toBe(200);
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

	describe("workflow commands", () => {
		const RUN_RECORD = {
			runId: 1,
			name: "tour-mode",
			status: "success",
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: "2026-01-01T00:00:01.000Z",
			durationMs: 1000,
			stepCount: 1,
			steps: [
				{ index: 0, command: "monitor.start", status: "success", durationMs: 5, error: null },
			],
			error: null,
		};

		function createWorkflowCtx() {
			return createTestCtx({
				dispatchCommand: vi.fn((command: BaseCommand) =>
					command.type === "workflow.run"
						? okAsync(RUN_RECORD)
						: errAsync(
								new CommandExecutionError(`Command '${command.type}' is not registered`, {
									reason: "not-registered",
									commandType: command.type,
								}),
							),
				),
			});
		}

		it("dispatches workflow.run with its name when the node allowlists it", async () => {
			const ctx = createWorkflowCtx();
			const { baseUrl } = await trackedStart(
				{ allowedCommands: ["workflow.run", "workflow.list"] },
				ctx,
			);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "workflow.run", name: "tour-mode" }),
			});

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ result: RUN_RECORD });
			expect(ctx.dispatchCommand).toHaveBeenCalledWith({
				type: "workflow.run",
				name: "tour-mode",
			});
		});

		it("rejects workflow.run under the default allowlist", async () => {
			const ctx = createWorkflowCtx();
			const { baseUrl } = await trackedStart({}, ctx);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "workflow.run", name: "tour-mode" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Command not allowed");
			expect(ctx.dispatchCommand).not.toHaveBeenCalled();
		});

		it("rejects workflow.run for a token whose role misses workflow.*", async () => {
			stubTokenEnv();
			const ctx = createWorkflowCtx();
			const { baseUrl } = await trackedStart(
				{
					auth: AUTH_OPTIONS,
					allowedCommands: ["workflow.run", "workflow.list"],
				},
				ctx,
			);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: docentHeader(),
				body: JSON.stringify({ type: "workflow.run", name: "tour-mode" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain('role "docent"');
			expect(ctx.dispatchCommand).not.toHaveBeenCalled();
		});

		it("dispatches workflow.run for a token role that covers workflow.*", async () => {
			stubTokenEnv();
			const ctx = createWorkflowCtx();
			const { baseUrl } = await trackedStart(
				{
					auth: {
						roles: { docent: ["workflow.*"], kiosk: [] },
						tokens: AUTH_OPTIONS.tokens,
					},
					allowedCommands: ["workflow.run", "workflow.list"],
				},
				ctx,
			);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: docentHeader(),
				body: JSON.stringify({ type: "workflow.run", name: "tour-mode" }),
			});

			expect(response.status).toBe(200);
		});

		it("serves the workflows slice at /state with nothing lost to placeholders", async () => {
			const state = {
				system: { mode: "persistent" },
				plugins: {
					workflows: {
						available: [{ name: "tour-mode", stepCount: 1 }],
						runs: { "tour-mode": RUN_RECORD },
					},
				},
				_version: 4,
			};
			const ctx = createTestCtx({ getGlobalState: vi.fn().mockReturnValue(state) });
			const { baseUrl } = await trackedStart({ exposeState: true }, ctx);

			const response = await fetch(`${baseUrl}/state`);

			expect(response.status).toBe(200);
			const body = await response.text();
			expect(body).not.toContain("[unserializable");
			expect(JSON.parse(body)).toEqual(state);
		});
	});

	describe("CORS", () => {
		it("responds to OPTIONS with 204 and preflight headers", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/events`, { method: "OPTIONS" });

			expect(response.status).toBe(204);
			expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
			expect(response.headers.get("access-control-allow-headers")).toBe(
				"Authorization, Content-Type",
			);
			expect(response.headers.get("access-control-max-age")).toBe("86400");
		});

		it("sets Access-Control-Allow-Origin: * on every response by default", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/status`);
			expect(response.headers.get("access-control-allow-origin")).toBe("*");
		});

		it("echoes a listed origin and varies on Origin", async () => {
			const { baseUrl } = await trackedStart({ allowedOrigins: ["http://tablet.local"] });

			const response = await fetch(`${baseUrl}/status`, {
				headers: { Origin: "http://tablet.local" },
			});

			expect(response.headers.get("access-control-allow-origin")).toBe("http://tablet.local");
			expect(response.headers.get("vary")).toBe("Origin");
		});

		it("omits the allow-origin header for an unlisted origin but still serves the request", async () => {
			const { baseUrl } = await trackedStart({ allowedOrigins: ["http://tablet.local"] });

			const response = await fetch(`${baseUrl}/status`, {
				headers: { Origin: "http://evil.local" },
			});

			// CORS is enforced by the browser, not by us: the request still ran.
			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
			expect(response.headers.get("vary")).toBe("Origin");
		});

		it("carries the configured origin on the SSE stream", async () => {
			const { baseUrl } = await trackedStart({ allowedOrigins: ["http://tablet.local"] });

			const response = await fetch(`${baseUrl}/events`, {
				headers: { Origin: "http://tablet.local" },
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe("http://tablet.local");
			await readSseFrames(response, 1);
		});

		it("carries CORS headers on a 401 so a browser can read the status", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart({ auth: AUTH_OPTIONS });

			const response = await fetch(`${baseUrl}/status`);

			expect(response.status).toBe(401);
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

	describe("auth", () => {
		it("rejects an unauthenticated command without dispatching it", async () => {
			stubTokenEnv();
			const { ctx, baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});

			expect(response.status).toBe(401);
			expect(response.headers.get("www-authenticate")).toBe("Bearer");
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toBe("Unauthorized");
			expect(ctx.dispatchCommand).not.toHaveBeenCalled();
		});

		it.each(["/status", "/state", "/events", "/nope"])(
			"rejects an unauthenticated GET %s with 401",
			async (path) => {
				stubTokenEnv();
				const { baseUrl } = await trackedStart({ ...AUTHED_TRANSPORT, exposeState: true });

				const response = await fetch(`${baseUrl}${path}`);

				// Auth precedes routing, so an anonymous caller cannot tell a real
				// route from a missing one.
				expect(response.status).toBe(401);
				expect(response.headers.get("content-type")).toBe("application/json");
			},
		);

		it.each([
			["an unknown value", `Bearer ${"wrong-token-value"}`],
			["a non-Bearer scheme", `Basic ${DOCENT_TOKEN}`],
			["no scheme at all", DOCENT_TOKEN],
		])("rejects %s with 401", async (_label, authorization) => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/status`, { headers: { authorization } });

			expect(response.status).toBe(401);
		});

		it("serves /status to a valid Bearer token", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			expect((await fetch(`${baseUrl}/status`, { headers: docentHeader() })).status).toBe(200);
		});

		it("opens the SSE stream for a token in the query string", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/events?access_token=${DOCENT_TOKEN}`);

			expect(response.status).toBe(200);
			expect(await readSseFrames(response, 1)).toEqual(["retry: 2000"]);
		});

		it("opens the SSE stream for a token in the Authorization header", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/events`, { headers: docentHeader() });

			expect(response.status).toBe(200);
			expect(await readSseFrames(response, 1)).toEqual(["retry: 2000"]);
		});

		it("does not accept ?access_token on /command", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/command?access_token=${DOCENT_TOKEN}`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});

			expect(response.status).toBe(401);
		});

		it("dispatches a command covered by the token role", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: docentHeader(),
				body: JSON.stringify({ type: "content.manifest.read" }),
			});

			expect(response.status).toBe(200);
		});

		it("rejects a command outside the token role with 403 naming the role", async () => {
			stubTokenEnv();
			const { ctx, baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: kioskHeader(),
				body: JSON.stringify({ type: "content.manifest.read" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain('role "kiosk"');
			expect(ctx.dispatchCommand).not.toHaveBeenCalled();
		});

		it("rejects a command in allowedCommands that the role's globs miss", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: docentHeader(),
				body: JSON.stringify({ type: "monitor.restart" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain('role "docent"');
		});

		it("still applies allowedCommands to an authenticated caller", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: docentHeader(),
				body: JSON.stringify({ type: "content.explode" }),
			});

			expect(response.status).toBe(403);
			const body = (await response.json()) as { error: { message: string } };
			expect(body.error.message).toContain("Command not allowed");
		});

		it("answers a preflight without a token", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			const response = await fetch(`${baseUrl}/command`, { method: "OPTIONS" });

			expect(response.status).toBe(204);
		});

		it("leaves every route open when no tokens are configured", async () => {
			const { baseUrl } = await trackedStart({ exposeState: true });

			expect((await fetch(`${baseUrl}/status`)).status).toBe(200);
			expect((await fetch(`${baseUrl}/state`)).status).toBe(200);
			expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
		});
	});

	describe("non-loopback guard", () => {
		it("refuses to bind a routable host with no tokens configured", async () => {
			const { result } = await trackedStart({ host: "0.0.0.0" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("0.0.0.0");
		});

		it("binds a routable host once tokens are configured", async () => {
			stubTokenEnv();
			const { result } = await trackedStart({ host: "0.0.0.0", auth: AUTH_OPTIONS });

			expect(result.isOk()).toBe(true);
		});

		it("binds a routable host when the operator opts out explicitly", async () => {
			const { result } = await trackedStart({ host: "0.0.0.0", allowUnauthenticated: true });

			expect(result.isOk()).toBe(true);
		});

		it("fails setup in task mode too when a token's environment variable is unset", async () => {
			const ctx = createTestCtx({ mode: "task" });

			const result = await httpTransport({ port: 0, auth: AUTH_OPTIONS }).setup(ctx);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("LAUNCHPAD_TOKEN_DOCENT");
		});
	});

	describe("roles without tokens guard", () => {
		it("refuses to start when auth.roles is declared with no auth.tokens", async () => {
			const { result } = await trackedStart({ auth: { roles: { docent: ["content.*"] } } });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("auth.roles");
			expect(result._unsafeUnwrapErr().message).toContain("auth.tokens");
		});

		it("fails setup in task mode too", async () => {
			const ctx = createTestCtx({ mode: "task" });

			const result = await httpTransport({
				port: 0,
				auth: { roles: { docent: ["content.*"] } },
			}).setup(ctx);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("auth.roles");
		});

		it("is not suppressed by allowUnauthenticated: true", async () => {
			const { result } = await trackedStart({
				allowUnauthenticated: true,
				auth: { roles: { docent: ["content.*"] } },
			});

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("auth.roles");
		});

		it("starts fine with roles declared and at least one token configured", async () => {
			stubTokenEnv();
			const { result } = await trackedStart({ auth: AUTH_OPTIONS });

			expect(result.isOk()).toBe(true);
		});
	});

	describe("token leakage", () => {
		it("keeps token values out of logs, state and /status across a full lifecycle", async () => {
			stubTokenEnv();
			const started = await trackedStart(AUTHED_TRANSPORT);
			const { ctx, baseUrl } = started;

			await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});
			await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: docentHeader(),
				body: JSON.stringify({ type: "content.ack" }),
			});
			await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: kioskHeader(),
				body: JSON.stringify({ type: "content.manifest.read" }),
			});
			const stream = await fetch(`${baseUrl}/events?access_token=${DOCENT_TOKEN}`);
			await readSseFrames(stream, 1);
			emitBusEvent(ctx, "content:foo", { hello: "world" });
			await readSseFrames(stream, 1);
			const statusBody = JSON.stringify(
				await (
					await fetch(`${baseUrl}/status`, {
						headers: docentHeader(),
					})
				).json(),
			);
			await started.result._unsafeUnwrap().disconnect?.({ type: "manual" });

			const loggedText = collectLoggedText(ctx.logger);
			for (const secret of [DOCENT_TOKEN, KIOSK_TOKEN]) {
				expect(loggedText).not.toContain(secret);
				expect(statusBody).not.toContain(secret);
				expect(JSON.stringify(ctx.getGlobalState())).not.toContain(secret);
			}
			// The operator still gets an audit trail: names, not values.
			expect(loggedText).toContain("docent-tablet");
			expect(ctx.updateState).not.toHaveBeenCalled();
		});

		it("redacts the query string when echoing a malformed request target", async () => {
			stubTokenEnv();
			const { baseUrl } = await trackedStart(AUTHED_TRANSPORT);
			if (baseUrl === undefined) {
				throw new Error("HTTP transport started without a base URL");
			}

			const rawResponse = await sendRawRequest(
				Number(new URL(baseUrl).port),
				`GET http://[::1?access_token=${DOCENT_TOKEN} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
			);

			expect(rawResponse).toContain("400");
			expect(rawResponse).toContain("<redacted>");
			expect(rawResponse).not.toContain(DOCENT_TOKEN);
		});
	});

	describe("authentication logging", () => {
		it("logs a successful authentication at debug, naming the token and role but never the value", async () => {
			stubTokenEnv();
			const { ctx, baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			await fetch(`${baseUrl}/command`, {
				method: "POST",
				headers: docentHeader(),
				body: JSON.stringify({ type: "content.ack" }),
			});

			const debugCalls = vi.mocked(ctx.logger.debug).mock.calls.flat();
			expect(debugCalls.some((call) => String(call).includes("docent-tablet"))).toBe(true);
			expect(debugCalls.some((call) => String(call).includes('role "docent"'))).toBe(true);
			expect(debugCalls.some((call) => String(call).includes(DOCENT_TOKEN))).toBe(false);
			expect(vi.mocked(ctx.logger.warn).mock.calls.flat()).toHaveLength(0);
		});

		it("logs a rejected authentication at warn, without a token identity", async () => {
			stubTokenEnv();
			const { ctx, baseUrl } = await trackedStart(AUTHED_TRANSPORT);

			await fetch(`${baseUrl}/command`, {
				method: "POST",
				body: JSON.stringify({ type: "content.ack" }),
			});

			const warnCalls = vi.mocked(ctx.logger.warn).mock.calls.flat();
			expect(warnCalls.some((call) => String(call).includes("POST /command"))).toBe(true);
			expect(warnCalls.some((call) => String(call).includes(DOCENT_TOKEN))).toBe(false);
		});

		it("does not log anything for an anonymous request when no tokens are configured", async () => {
			const { ctx, baseUrl } = await trackedStart();

			await fetch(`${baseUrl}/status`);

			expect(vi.mocked(ctx.logger.debug).mock.calls).toHaveLength(0);
			expect(vi.mocked(ctx.logger.warn).mock.calls).toHaveLength(0);
		});
	});

	describe("sequence numbers", () => {
		it("numbers the first live frame 1", async () => {
			const { ctx, baseUrl } = await trackedStart();
			const response = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", { hello: "world" });

			expect((await readNextEventFrame(response)).id).toBe(1);
		});

		it("increments by one across different event names", async () => {
			const { ctx, baseUrl } = await trackedStart({ events: ["content:*"] });
			const response = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", {});
			emitBusEvent(ctx, "content:bar", {});
			emitBusEvent(ctx, "content:foo", {});

			const frames = await readParsedFrames(response, 3);
			expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3]);
		});

		it("gives two concurrent clients the same id for the same frame", async () => {
			const { ctx, baseUrl } = await trackedStart();
			const first = await openEventStream(String(baseUrl));
			const second = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", {});

			expect((await readNextEventFrame(first)).id).toBe(1);
			expect((await readNextEventFrame(second)).id).toBe(1);
		});

		it("does not burn a sequence number on a filtered-out event", async () => {
			const { ctx, baseUrl } = await trackedStart();
			const response = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", {});
			emitBusEvent(ctx, "monitor:bar", { dropped: true });
			emitBusEvent(ctx, "content:baz", {});

			const frames = await readParsedFrames(response, 2);
			expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
		});

		it("writes no id on keep-alive comments and does not advance the counter", async () => {
			const { ctx, baseUrl } = await trackedStart({ keepAliveMs: 30 });
			const response = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", {});
			expect((await readNextEventFrame(response)).id).toBe(1);

			expect(await readNextPingFrame(response)).toBe(": ping");

			emitBusEvent(ctx, "content:bar", {});
			expect((await readNextEventFrame(response)).id).toBe(2);
		});

		it("writes no id on the retry directive", async () => {
			const { baseUrl } = await trackedStart();

			const response = await fetch(`${baseUrl}/events`);
			const [retryFrame] = await readSseFrames(response, 1);

			expect(retryFrame).toBe("retry: 2000");
		});

		it("writes no id on replayed frames and resumes the live counter after them", async () => {
			const { ctx, baseUrl } = await trackedStart({ replayEvents: ["content:foo"] });
			const live = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", { round: 1 });
			expect((await readNextEventFrame(live)).id).toBe(1);

			const late = await fetch(`${baseUrl}/events`);
			const [, replayFrame] = await readParsedFrames(late, 2);
			expect(replayFrame?.id).toBeUndefined();
			expect(replayFrame?.event).toBe("content:foo");

			emitBusEvent(ctx, "content:bar", {});
			expect((await readNextEventFrame(late)).id).toBe(2);
		});

		it("lets a late client baseline mid-stream instead of at 1", async () => {
			const { ctx, baseUrl } = await trackedStart();
			const early = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", {});
			emitBusEvent(ctx, "content:bar", {});
			await readParsedFrames(early, 2);

			const late = await openEventStream(String(baseUrl));
			emitBusEvent(ctx, "content:baz", {});

			expect((await readNextEventFrame(late)).id).toBe(3);
		});

		it("shares one counter between event frames and state frames", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart(PUSH_STATE, ctx);
			const response = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "content:foo", {});
			patchSource.emit(samplePatch("v1"), 1);
			emitBusEvent(ctx, "content:bar", {});

			const frames = await readParsedFrames(response, 3);
			expect(frames.map((frame) => frame.event)).toEqual([
				"content:foo",
				"launchpad:state:patch",
				"content:bar",
			]);
			expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3]);
		});
	});

	describe("state push", () => {
		it("pushes a state patch frame carrying the patches and the store version", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart(PUSH_STATE, ctx);
			const response = await openEventStream(String(baseUrl));

			const patches = samplePatch("20260714T153045Z");
			patchSource.emit(patches, 12);

			const frame = await readNextEventFrame(response);
			expect(frame.event).toBe("launchpad:state:patch");
			expect(JSON.parse(frame.data)).toEqual({ patches, version: 12 });
		});

		it("forwards a version gap verbatim instead of renumbering", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart(PUSH_STATE, ctx);
			const response = await openEventStream(String(baseUrl));

			patchSource.emit(samplePatch("a"), 1);
			patchSource.emit(samplePatch("b"), 3);

			const frames = await readParsedFrames(response, 2);
			expect(frames.map((frame) => JSON.parse(frame.data).version)).toEqual([1, 3]);
		});

		it("pushes nothing by default", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart({}, ctx);
			const response = await openEventStream(String(baseUrl));

			patchSource.emit(samplePatch("ignored"), 1);
			emitBusEvent(ctx, "content:foo", { live: true });

			const frame = await readNextEventFrame(response);
			expect(frame.event).toBe("content:foo");
		});

		it("fails setup when pushStatePatches is enabled without exposeState", async () => {
			const { result } = await startHttpTransport({ pushStatePatches: true });

			expect(result.isErr()).toBe(true);
			const message = result._unsafeUnwrapErr().message;
			expect(message).toContain("pushStatePatches");
			expect(message).toContain("exposeState");
		});

		it("pushes a status snapshot frame when pushStatusSnapshots is on", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart({ pushStatusSnapshots: true }, ctx);
			const response = await openEventStream(String(baseUrl));

			patchSource.emit(samplePatch("a"), 1);

			const frame = await readNextEventFrame(response);
			expect(frame.event).toBe("launchpad:status:snapshot");
			expect(JSON.parse(frame.data)).toEqual(JSON.parse(serializeJSON(ctx.getStatusSnapshot())));
		});

		it("orders the patch frame ahead of the snapshot frame, on consecutive ids", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart({ ...PUSH_STATE, pushStatusSnapshots: true }, ctx);
			const response = await openEventStream(String(baseUrl));

			patchSource.emit(samplePatch("a"), 1);

			const frames = await readParsedFrames(response, 2);
			expect(frames.map((frame) => frame.event)).toEqual([
				"launchpad:state:patch",
				"launchpad:status:snapshot",
			]);
			expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
		});

		it("does not build a status snapshot when no client is connected", async () => {
			const { ctx, patchSource } = createPatchCtx();
			await trackedStart({ pushStatusSnapshots: true }, ctx);

			patchSource.emit(samplePatch("a"), 1);

			expect(ctx.getStatusSnapshot).toHaveBeenCalledTimes(0);
		});

		it("holds no patch subscription when neither push option is set", async () => {
			const { ctx, onGlobalStatePatch } = createPatchCtx();
			await trackedStart({}, ctx);

			expect(onGlobalStatePatch).not.toHaveBeenCalled();
		});

		it("unsubscribes from state patches on disconnect", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const started = await startHttpTransport(PUSH_STATE, ctx);

			await started.result._unsafeUnwrap().disconnect?.({ type: "manual" });

			expect(patchSource.unsubscribeCalls()).toBe(1);
		});

		it("warns once when pushed state degrades to a placeholder", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart(PUSH_STATE, ctx);
			const response = await openEventStream(String(baseUrl));

			patchSource.emit(samplePatch(new Map([["a", 1]])), 1);
			const frame = await readNextEventFrame(response);
			expect(frame.data).toContain("[unserializable: map]");
			expect(countWarnings(ctx, "JSON serialization")).toBe(1);

			patchSource.emit(samplePatch(new Map([["b", 2]])), 2);
			await readNextEventFrame(response);
			expect(countWarnings(ctx, "JSON serialization")).toBe(1);
		});

		it("does not warn for JSON-native pushed state", async () => {
			const { ctx, patchSource } = createPatchCtx();
			const { baseUrl } = await trackedStart(PUSH_STATE, ctx);
			const response = await openEventStream(String(baseUrl));

			patchSource.emit(samplePatch({ versionId: "abc", count: 2 }), 1);
			await readNextEventFrame(response);

			expect(countWarnings(ctx, "JSON serialization")).toBe(0);
		});
	});

	describe("reserved frame prefix", () => {
		it("refuses to forward a bus event named like a transport frame", async () => {
			const { ctx, baseUrl } = await trackedStart({ events: ["*"] });
			const response = await openEventStream(String(baseUrl));

			emitBusEvent(ctx, "launchpad:state:patch", { forged: true });
			emitBusEvent(ctx, "content:foo", { real: true });

			const frame = await readNextEventFrame(response);
			expect(frame.event).toBe("content:foo");
			// The forged frame consumed no sequence number.
			expect(frame.id).toBe(1);
			expect(countWarnings(ctx, "reserved")).toBe(1);
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
