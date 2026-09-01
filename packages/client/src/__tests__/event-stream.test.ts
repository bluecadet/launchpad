import { describe, expect, it, vi } from "vitest";
import { createClient } from "../client.js";
import type { ConnectionEvent, EventFrame } from "../event-stream.js";
import { createFakeFetch, createSseServer, jsonResponse } from "./fake-fetch.js";

const BASE_URL = "http://127.0.0.1:8710";

function setup(options: { onError?: (error: unknown) => void } = {}) {
	const sse = createSseServer();
	const fake = createFakeFetch((request) => {
		if (new URL(request.url).pathname === "/events") {
			return sse.respond();
		}
		return jsonResponse(200, { result: null });
	});
	const client = createClient({
		baseUrl: BASE_URL,
		fetch: fake.fetchFn,
		reconnectDelayMs: 1,
		onError: options.onError,
	});
	return { sse, fake, client };
}

function frame(event: string, data: unknown, id?: number) {
	const idLine = id === undefined ? "" : `id: ${id}\n`;
	return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Waits for the SDK to have opened `count` connections. */
async function waitForConnections(sse: ReturnType<typeof createSseServer>, count: number) {
	await vi.waitFor(() => expect(sse.connections.length).toBe(count));
}

describe("event stream", () => {
	it("delivers frames with their sequence number", async () => {
		const { sse, client } = setup();
		const frames: EventFrame[] = [];
		client.subscribeEvents((received) => frames.push(received));
		await waitForConnections(sse, 1);

		sse.current().write("retry: 2000\n\n");
		sse.current().write(frame("content:version:promoted", { versionId: "v1" }, 12));

		await vi.waitFor(() => expect(frames).toHaveLength(1));
		expect(frames[0]).toEqual({
			event: "content:version:promoted",
			data: { versionId: "v1" },
			seq: 12,
			replayed: false,
		});
		client.close();
	});

	it("marks an untagged backlog frame as replayed", async () => {
		const { sse, client } = setup();
		const frames: EventFrame[] = [];
		client.subscribeEvents((received) => frames.push(received));
		await waitForConnections(sse, 1);

		sse.current().write(frame("content:version:promoted", { versionId: "old" }));

		await vi.waitFor(() => expect(frames).toHaveLength(1));
		expect(frames[0]?.replayed).toBe(true);
		expect(frames[0]?.seq).toBeUndefined();
		client.close();
	});

	it("reports a gap when an id skips, and nothing when it does not", async () => {
		const { sse, client } = setup();
		const notices: ConnectionEvent[] = [];
		client.onConnection((event) => notices.push(event));
		await waitForConnections(sse, 1);

		sse.current().write(frame("content:foo", 1, 12));
		sse.current().write(frame("content:foo", 2, 13));
		sse.current().write(frame("content:foo", 3, 16));

		await vi.waitFor(() => expect(notices.some((event) => event.type === "gap")).toBe(true));
		expect(notices).toEqual([{ type: "connected" }, { type: "gap", expected: 14, received: 16 }]);
		client.close();
	});

	it("does not treat an untagged frame between sequenced ones as a gap", async () => {
		const { sse, client } = setup();
		const notices: ConnectionEvent[] = [];
		const frames: EventFrame[] = [];
		client.onConnection((event) => notices.push(event));
		client.subscribeEvents((received) => frames.push(received));
		await waitForConnections(sse, 1);

		sse.current().write(frame("content:foo", 1, 12));
		sse.current().write(frame("content:foo", "replayed"));
		sse.current().write(frame("content:foo", 2, 13));

		await vi.waitFor(() => expect(frames).toHaveLength(3));
		expect(notices.filter((event) => event.type === "gap")).toEqual([]);
		client.close();
	});

	it("reconnects after a drop, reports it as a resync, and re-baselines", async () => {
		const { sse, client } = setup();
		const notices: ConnectionEvent[] = [];
		client.onConnection((event) => notices.push(event));
		await waitForConnections(sse, 1);
		sse.current().write(frame("content:foo", 1, 12));

		sse.current().end();
		await waitForConnections(sse, 2);
		sse.current().write(frame("content:foo", 2, 400));
		sse.current().write(frame("content:foo", 3, 401));

		await vi.waitFor(() =>
			expect(notices.some((event) => event.type === "reconnected")).toBe(true),
		);
		expect(notices.map((event) => event.type)).toEqual([
			"connected",
			"disconnected",
			"reconnected",
		]);
		client.close();
	});

	it("routes a typed handler only its own event", async () => {
		const { sse, client } = setup();
		const logged = vi.fn();
		client.on("log:info", logged);
		await waitForConnections(sse, 1);

		sse.current().write(frame("content:foo", { ignored: true }, 1));
		sse.current().write(frame("log:info", { message: "hello" }, 2));

		await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
		expect(logged.mock.calls[0]?.[0]).toEqual({ message: "hello" });
		client.close();
	});

	it("opens one connection for many subscribers and closes it with the last", async () => {
		const { sse, client } = setup();
		const first = client.subscribeEvents(() => undefined);
		const second = client.subscribeEvents(() => undefined);
		await waitForConnections(sse, 1);

		first();
		second();
		sse.current().end();

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(sse.connections).toHaveLength(1);
	});

	it("unsubscribes when the supplied signal aborts", async () => {
		const { sse, client } = setup();
		const controller = new AbortController();
		const frames: EventFrame[] = [];
		client.subscribeEvents((received) => frames.push(received), { signal: controller.signal });
		await waitForConnections(sse, 1);

		controller.abort();
		sse.current().write(frame("content:foo", 1, 1));

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(frames).toEqual([]);
	});

	it("reports a rejected connection and keeps retrying", async () => {
		const sse = createSseServer();
		let attempts = 0;
		const fake = createFakeFetch(() => {
			attempts += 1;
			if (attempts === 1) {
				return jsonResponse(503, { error: { message: "Too many SSE clients" } });
			}
			return sse.respond();
		});
		const errors: unknown[] = [];
		const client = createClient({
			baseUrl: BASE_URL,
			fetch: fake.fetchFn,
			reconnectDelayMs: 1,
			onError: (error) => errors.push(error),
		});
		const notices: ConnectionEvent[] = [];
		client.onConnection((event) => notices.push(event));
		const frames: EventFrame[] = [];
		client.subscribeEvents((received) => frames.push(received));

		await waitForConnections(sse, 1);
		sse.current().write(frame("content:foo", 1, 1));

		await vi.waitFor(() => expect(frames).toHaveLength(1));
		expect(errors).toHaveLength(1);
		// A 503 is a blip: the disconnect that reports it is not the end of the loop.
		expect(notices[0]).toMatchObject({ type: "disconnected" });
		expect(notices[0]).not.toHaveProperty("terminal");
		client.close();
	});

	it.each([
		[401, "unauthorized"],
		[403, "forbidden"],
		[404, "not-found"],
	])("gives up on a %i from /events instead of retrying", async (status, reason) => {
		let attempts = 0;
		const fake = createFakeFetch(() => {
			attempts += 1;
			return jsonResponse(status, { error: { message: "Nope" } });
		});
		const errors: unknown[] = [];
		const client = createClient({
			baseUrl: BASE_URL,
			fetch: fake.fetchFn,
			reconnectDelayMs: 1,
			onError: (error) => errors.push(error),
		});
		const notices: ConnectionEvent[] = [];
		client.onConnection((event) => notices.push(event));
		client.subscribeEvents(() => undefined);

		await vi.waitFor(() => expect(notices).toHaveLength(1));
		expect(notices[0]).toMatchObject({ type: "disconnected", terminal: true });
		expect(notices[0]).toMatchObject({ error: { reason, status } });

		// Long enough for several backoff rounds at a 1ms base delay.
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(attempts).toBe(1);
		expect(notices).toHaveLength(1);
		client.close();
	});

	it("treats the connection after the last subscriber left as a reconnect", async () => {
		const { sse, client } = setup();
		const first = client.subscribeEvents(() => undefined);
		await waitForConnections(sse, 1);
		first();

		const notices: ConnectionEvent[] = [];
		client.onConnection((event) => notices.push(event));
		await waitForConnections(sse, 2);

		// Every reconnect is a gap, whichever subscriber is around to hear about it.
		await vi.waitFor(() => expect(notices).toContainEqual({ type: "reconnected" }));
		expect(notices).not.toContainEqual({ type: "connected" });
		client.close();
	});

	it("sends the bearer token as a header, never as a query parameter", async () => {
		const sse = createSseServer();
		const fake = createFakeFetch(() => sse.respond());
		const client = createClient({
			baseUrl: BASE_URL,
			token: "secret-token",
			fetch: fake.fetchFn,
			reconnectDelayMs: 1,
		});
		client.subscribeEvents(() => undefined);

		await waitForConnections(sse, 1);
		expect(fake.calls[0]?.headers.get("authorization")).toBe("Bearer secret-token");
		expect(fake.calls[0]?.url).toBe(`${BASE_URL}/events`);
		client.close();
	});
});
