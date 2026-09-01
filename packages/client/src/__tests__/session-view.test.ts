import type { Session } from "@bluecadet/launchpad-session";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "../client.js";
import type { SessionView } from "../session-view.js";
import { createFakeFetch, createSseServer, jsonResponse } from "./fake-fetch.js";

const BASE_URL = "http://127.0.0.1:8710";

type SessionOverrides = Partial<Omit<Session, "sessionId" | "visitorId">> & {
	sessionId?: string;
	visitorId?: string;
};

function session(overrides: SessionOverrides = {}): Session {
	return {
		sessionId: "s-1",
		visitorId: "v-1",
		language: "en",
		degraded: false,
		seq: 1,
		...overrides,
	} as Session;
}

type CurrentResult = { session: Session | null; profile: Record<string, unknown> | null };

function setup(results: CurrentResult[]) {
	const sse = createSseServer();
	const commands: string[] = [];
	let index = 0;
	const fake = createFakeFetch(async (request) => {
		const path = new URL(request.url).pathname;
		if (path === "/events") {
			return sse.respond();
		}
		if (path === "/command") {
			const body: unknown = JSON.parse(await request.text());
			commands.push(String((body as { type: string }).type));
			const result = results[Math.min(index, results.length - 1)];
			index += 1;
			return jsonResponse(200, { result });
		}
		return jsonResponse(404, { error: { message: "Not found" } });
	});
	const errors: unknown[] = [];
	const client = createClient({
		baseUrl: BASE_URL,
		fetch: fake.fetchFn,
		reconnectDelayMs: 1,
		onError: (error) => errors.push(error),
	});
	return { sse, client, commands, errors, queries: () => index };
}

function frame(event: string, data: unknown, id: number) {
	return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("onSession", () => {
	it("queries session.current on subscribe", async () => {
		const current = { session: session(), profile: { tier: "member" } };
		const { client, commands } = setup([current]);
		const views: SessionView[] = [];
		client.onSession((view) => views.push(view));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		expect(commands).toEqual(["session.current"]);
		expect(views[0]).toEqual({
			session: current.session,
			profile: current.profile,
			degraded: false,
		});
		client.close();
	});

	it("re-queries after session:started so the profile arrives", async () => {
		const started = session({ sessionId: "s-2", seq: 1 });
		const { sse, client, views } = withViews(
			setup([
				{ session: null, profile: null },
				{ session: started, profile: { tier: "vip" } },
			]),
		);

		await vi.waitFor(() => expect(views).toHaveLength(1));
		await vi.waitFor(() => expect(sse.connections).toHaveLength(1));
		sse.current().write(frame("session:started", { session: started }, 1));

		await vi.waitFor(() => expect(views.at(-1)?.profile).toEqual({ tier: "vip" }));
		expect(views.at(-1)?.session).toEqual(started);
		client.close();
	});

	// The broker ends a Session without bumping its `seq`, so the frame carries the same
	// revision the view is already holding.
	it("applies session:ended locally without a re-query", async () => {
		const open = session({ sessionId: "s-3" });
		const { sse, client, views, harness } = withViews(
			setup([{ session: open, profile: { tier: "member" } }]),
		);

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse.current().write(frame("session:ended", { session: open, reason: "timeout" }, 1));

		await vi.waitFor(() => expect(views).toHaveLength(2));
		expect(views[1]).toEqual({ session: null, profile: null, degraded: false });
		expect(harness.queries()).toBe(1);
		client.close();
	});

	it("ignores an ended frame for a Session that is no longer current", async () => {
		const open = session({ sessionId: "s-4" });
		const { sse, client, views } = withViews(setup([{ session: open, profile: null }]));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse
			.current()
			.write(
				frame(
					"session:ended",
					{ session: session({ sessionId: "s-older" }), reason: "replaced" },
					1,
				),
			);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(views).toHaveLength(1);
		client.close();
	});

	it("drops an ended frame for an older revision of the Session it holds", async () => {
		const current = session({ sessionId: "s-4b", seq: 4 });
		const { sse, client, views } = withViews(setup([{ session: current, profile: null }]));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse
			.current()
			.write(
				frame(
					"session:ended",
					{ session: session({ sessionId: "s-4b", seq: 3 }), reason: "timeout" },
					1,
				),
			);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(views).toHaveLength(1);
		expect(views[0]?.session).toEqual(current);
		client.close();
	});

	it("ignores an ended frame while the Station is already idle", async () => {
		const { sse, client, views } = withViews(setup([{ session: null, profile: null }]));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse
			.current()
			.write(
				frame("session:ended", { session: session({ sessionId: "s-4c" }), reason: "timeout" }, 1),
			);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(views).toHaveLength(1);
		client.close();
	});

	it("drops a canon frame with a stale seq for the same Session", async () => {
		const current = session({ sessionId: "s-5", seq: 4, language: "en" });
		const { sse, client, views } = withViews(setup([{ session: current, profile: null }]));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse
			.current()
			.write(
				frame(
					"session:current",
					{ session: session({ sessionId: "s-5", seq: 3, language: "fr" }) },
					1,
				),
			);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(views).toHaveLength(1);
		expect(views[0]?.session?.language).toBe("en");
		client.close();
	});

	it("accepts a newer revision of the same Session", async () => {
		const current = session({ sessionId: "s-6", seq: 4 });
		const { sse, client, views } = withViews(setup([{ session: current, profile: { a: 1 } }]));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse
			.current()
			.write(
				frame(
					"session:current",
					{ session: session({ sessionId: "s-6", seq: 5, language: "fr" }) },
					1,
				),
			);

		await vi.waitFor(() => expect(views).toHaveLength(2));
		expect(views[1]?.session?.language).toBe("fr");
		// The Profile belongs to the same Session, so it survives the revision.
		expect(views[1]?.profile).toEqual({ a: 1 });
		client.close();
	});

	it("tracks the vendor link through session:degraded", async () => {
		const { sse, client, views } = withViews(setup([{ session: null, profile: null }]));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse.current().write(frame("session:degraded", { degraded: true }, 1));

		await vi.waitFor(() => expect(views).toHaveLength(2));
		expect(views[1]?.degraded).toBe(true);
		client.close();
	});

	it("keeps a recovered vendor link when a re-query answers with a stale snapshot", async () => {
		// The canon's own `degraded` was written when the Session opened; the transitions
		// that follow are more current, and a re-query must not undo them.
		const open = session({ sessionId: "s-deg", degraded: false });
		const stale = session({ sessionId: "s-deg", seq: 2, degraded: true });
		const { sse, client, views } = withViews(
			setup([
				{ session: open, profile: null },
				{ session: stale, profile: null },
			]),
		);

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse.current().write(frame("session:degraded", { degraded: true }, 1));
		await vi.waitFor(() => expect(views.at(-1)?.degraded).toBe(true));
		sse.current().write(frame("session:degraded", { degraded: false }, 2));
		await vi.waitFor(() => expect(views.at(-1)?.degraded).toBe(false));

		sse.current().end();

		await vi.waitFor(() => expect(views.at(-1)?.session?.seq).toBe(2));
		expect(views.at(-1)?.degraded).toBe(false);
		// The two flags legitimately disagree until the visitor taps again.
		expect(views.at(-1)?.session?.degraded).toBe(true);
		client.close();
	});

	it("re-issues a query whose answer an event discarded in flight", async () => {
		const active = session({ sessionId: "s-flight" });
		const sse = createSseServer();
		let releaseFirstQuery: (() => void) | undefined;
		let queries = 0;
		const fake = createFakeFetch(async (request) => {
			if (new URL(request.url).pathname === "/events") {
				return sse.respond();
			}
			queries += 1;
			if (queries === 1) {
				await new Promise<void>((resolve) => {
					releaseFirstQuery = resolve;
				});
			}
			return jsonResponse(200, { result: { session: active, profile: { tier: "member" } } });
		});
		const client = createClient({ baseUrl: BASE_URL, fetch: fake.fetchFn, reconnectDelayMs: 1 });
		const views: SessionView[] = [];
		client.onSession((view) => views.push(view));

		await vi.waitFor(() => expect(sse.connections).toHaveLength(1));
		await vi.waitFor(() => expect(releaseFirstQuery).toBeDefined());
		// Lands while the subscribe-time query is still open, which throws its answer away.
		sse.current().write(frame("session:degraded", { degraded: true }, 1));
		await vi.waitFor(() => expect(views).toHaveLength(1));
		releaseFirstQuery?.();

		await vi.waitFor(() => expect(views.at(-1)?.session).toEqual(active));
		expect(views.at(-1)?.profile).toEqual({ tier: "member" });
		expect(views.at(-1)?.degraded).toBe(true);
		expect(queries).toBe(2);
		client.close();
	});

	it("does nothing when subscribed with an already-aborted signal", async () => {
		const { sse, client, commands } = setup([{ session: session(), profile: null }]);
		const controller = new AbortController();
		controller.abort();
		const views: SessionView[] = [];

		const stop = client.onSession((view) => views.push(view), { signal: controller.signal });

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(views).toEqual([]);
		expect(commands).toEqual([]);
		expect(sse.connections).toHaveLength(0);
		stop();
		client.close();
	});

	it("re-queries after a reconnect", async () => {
		const { sse, client, harness } = withViews(setup([{ session: null, profile: null }]));

		await vi.waitFor(() => expect(harness.queries()).toBe(1));
		sse.current().end();

		await vi.waitFor(() => expect(sse.connections).toHaveLength(2));
		await vi.waitFor(() => expect(harness.queries()).toBe(2));
		client.close();
	});

	it("ignores replayed frames, which the subscribe-time query already covers", async () => {
		const current = session({ sessionId: "s-7" });
		const { sse, client, views } = withViews(setup([{ session: current, profile: null }]));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse.current().write(`event: session:current\ndata: ${JSON.stringify({ session: null })}\n\n`);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(views).toHaveLength(1);
		expect(views[0]?.session).toEqual(current);
		client.close();
	});

	it("keeps the last view when session.current fails", async () => {
		const open = session({ sessionId: "s-8" });
		const sse = createSseServer();
		let calls = 0;
		const fake = createFakeFetch((request) => {
			if (new URL(request.url).pathname === "/events") {
				return sse.respond();
			}
			calls += 1;
			if (calls === 1) {
				return jsonResponse(200, { result: { session: open, profile: { tier: "member" } } });
			}
			return jsonResponse(500, {
				error: { name: "CommandExecutionError", reason: "handler-failed", message: "boom" },
			});
		});
		const errors: unknown[] = [];
		const client = createClient({
			baseUrl: BASE_URL,
			fetch: fake.fetchFn,
			reconnectDelayMs: 1,
			onError: (error) => errors.push(error),
		});
		const views: SessionView[] = [];
		client.onSession((view) => views.push(view));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		sse.current().end();

		await vi.waitFor(() => expect(errors).toHaveLength(1));
		expect(views).toHaveLength(1);
		expect(views[0]?.session).toEqual(open);
		client.close();
	});

	it("stops emitting once unsubscribed", async () => {
		const open = session({ sessionId: "s-9" });
		const { sse, client } = setup([{ session: open, profile: null }]);
		const views: SessionView[] = [];
		const stop = client.onSession((view) => views.push(view));

		await vi.waitFor(() => expect(views).toHaveLength(1));
		stop();
		sse.current().write(frame("session:ended", { session: open, reason: "explicit" }, 1));

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(views).toHaveLength(1);
		client.close();
	});
});

/** Subscribes and records every view, keeping each test's setup to one line. */
function withViews(harness: ReturnType<typeof setup>) {
	const views: SessionView[] = [];
	harness.client.onSession((view) => views.push(view));
	return { ...harness, views, harness };
}
