import { describe, expect, it, vi } from "vitest";
import { createClient } from "../client.js";
import type { VersionedWireState } from "../types.js";
import { createFakeFetch, createSseServer, jsonResponse } from "./fake-fetch.js";

const BASE_URL = "http://127.0.0.1:8710";

function stateAt(version: number, activeVersion: string): VersionedWireState {
	return {
		system: {
			startTime: "2026-07-14T15:30:47.112Z",
			mode: "persistent",
			node: { id: "kiosk-1", label: "Kiosk 1" },
		},
		plugins: { content: { activeVersion } } as VersionedWireState["plugins"],
		_version: version,
	};
}

function setup(options: { stateResponses?: Response[] } = {}) {
	const sse = createSseServer();
	const states = [stateAt(19, "v1"), stateAt(25, "refetched")];
	let stateCalls = 0;
	const fake = createFakeFetch((request) => {
		const path = new URL(request.url).pathname;
		if (path === "/events") {
			return sse.respond();
		}
		if (path === "/state") {
			const override = options.stateResponses?.[stateCalls];
			stateCalls += 1;
			return override ?? jsonResponse(200, states[Math.min(stateCalls - 1, states.length - 1)]);
		}
		return jsonResponse(404, { error: { message: `Not found: GET ${path}` } });
	});
	const errors: unknown[] = [];
	const client = createClient({
		baseUrl: BASE_URL,
		fetch: fake.fetchFn,
		reconnectDelayMs: 1,
		onError: (error) => errors.push(error),
	});
	return { sse, client, errors, stateCalls: () => stateCalls };
}

function patchFrame(version: number, value: string, id: number) {
	const payload = {
		patches: [{ op: "replace", path: ["plugins", "content", "activeVersion"], value }],
		version,
	};
	return `id: ${id}\nevent: launchpad:state:patch\ndata: ${JSON.stringify(payload)}\n\n`;
}

describe("subscribeStatePatches", () => {
	it("emits the baseline read, then applies consecutive patches", async () => {
		const { sse, client } = setup();
		const seen: VersionedWireState[] = [];
		client.subscribeStatePatches((state) => seen.push(state));

		await vi.waitFor(() => expect(seen).toHaveLength(1));
		await vi.waitFor(() => expect(sse.connections).toHaveLength(1));
		sse.current().write(patchFrame(20, "v2", 1));

		await vi.waitFor(() => expect(seen).toHaveLength(2));
		expect(seen[1]?._version).toBe(20);
		expect(seen[1]?.plugins).toEqual({ content: { activeVersion: "v2" } });
		client.close();
	});

	it("re-reads the whole tree when a patch version skips", async () => {
		const { sse, client, stateCalls } = setup();
		const seen: VersionedWireState[] = [];
		client.subscribeStatePatches((state) => seen.push(state));

		await vi.waitFor(() => expect(seen).toHaveLength(1));
		await vi.waitFor(() => expect(sse.connections).toHaveLength(1));
		sse.current().write(patchFrame(24, "skipped", 1));

		await vi.waitFor(() => expect(stateCalls()).toBe(2));
		await vi.waitFor(() => expect(seen).toHaveLength(2));
		expect(seen[1]?._version).toBe(25);
		expect(seen[1]?.plugins).toEqual({ content: { activeVersion: "refetched" } });
		client.close();
	});

	it("re-reads the whole tree after a reconnect", async () => {
		const { sse, client, stateCalls } = setup();
		client.subscribeStatePatches(() => undefined);

		await vi.waitFor(() => expect(sse.connections).toHaveLength(1));
		sse.current().end();

		await vi.waitFor(() => expect(sse.connections).toHaveLength(2));
		await vi.waitFor(() => expect(stateCalls()).toBe(2));
		client.close();
	});

	it("reports a failed baseline read without throwing", async () => {
		const { client, errors } = setup({
			stateResponses: [jsonResponse(404, { error: { message: "Not found: GET /state" } })],
		});
		const seen: VersionedWireState[] = [];
		client.subscribeStatePatches((state) => seen.push(state));

		await vi.waitFor(() => expect(errors).toHaveLength(1));
		expect(seen).toEqual([]);
		client.close();
	});

	it("re-reads and reports when a patch frame is malformed", async () => {
		const { sse, client, errors, stateCalls } = setup();
		client.subscribeStatePatches(() => undefined);

		await vi.waitFor(() => expect(sse.connections).toHaveLength(1));
		await vi.waitFor(() => expect(stateCalls()).toBe(1));
		sse.current().write('id: 4\nevent: launchpad:state:patch\ndata: {"patches":"nope"}\n\n');

		await vi.waitFor(() => expect(errors).toHaveLength(1));
		await vi.waitFor(() => expect(stateCalls()).toBe(2));
		client.close();
	});

	it("ignores frames that are not state patches", async () => {
		const { sse, client, stateCalls } = setup();
		const seen: VersionedWireState[] = [];
		client.subscribeStatePatches((state) => seen.push(state));

		await vi.waitFor(() => expect(seen).toHaveLength(1));
		sse.current().write('id: 1\nevent: content:foo\ndata: {"a":1}\n\n');

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(seen).toHaveLength(1);
		expect(stateCalls()).toBe(1);
		client.close();
	});

	it("does nothing when subscribed with an already-aborted signal", async () => {
		const { sse, client, stateCalls } = setup();
		const controller = new AbortController();
		controller.abort();
		const seen: VersionedWireState[] = [];

		const unsubscribe = client.subscribeStatePatches((state) => seen.push(state), {
			signal: controller.signal,
		});

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(seen).toEqual([]);
		expect(stateCalls()).toBe(0);
		expect(sse.connections).toHaveLength(0);
		unsubscribe();
		client.close();
	});

	it("stops emitting once unsubscribed", async () => {
		const { sse, client } = setup();
		const seen: VersionedWireState[] = [];
		const unsubscribe = client.subscribeStatePatches((state) => seen.push(state));

		await vi.waitFor(() => expect(seen).toHaveLength(1));
		unsubscribe();
		sse.current().write(patchFrame(20, "v2", 1));

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(seen).toHaveLength(1);
	});
});
