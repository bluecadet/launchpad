import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import { toWebHandler } from "h3";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { definePage } from "../../dashboard-page.js";
import { definePanel } from "../../dashboard-panel.js";
import { createH3App, type ServerDeps } from "../h3-server.js";
import { SseManager } from "../sse-manager.js";

vi.mock("@bluecadet/launchpad-utils/panel-registry", () => ({
	registry: {
		getScripts: vi.fn().mockReturnValue([]),
		getStyles: vi.fn().mockReturnValue([]),
		getPanels: vi.fn().mockReturnValue([]),
		getPages: vi.fn().mockReturnValue([]),
		contributePanel: vi.fn(),
		contributePage: vi.fn(),
		contributeScript: vi.fn(),
		contributeStyle: vi.fn(),
		removePanel: vi.fn(),
		removePage: vi.fn(),
		removeScript: vi.fn(),
		removeStyle: vi.fn(),
		reset: vi.fn(),
	},
}));

const mockState: VersionedLaunchpadState = {
	system: { startTime: new Date(), mode: "task" },
	plugins: {},
	_version: 0,
};

const testPanel = definePanel({
	id: "test-panel",
	title: "Test Panel",
	render: () => "<p>panel content</p>",
});

const testPage = definePage({
	id: "test-page",
	title: "Test Page",
	panels: [testPanel],
});

function makeDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
	return {
		getPanels: () => [testPanel],
		getPages: () => [testPage],
		getState: () => mockState,
		dispatchCommand: vi.fn().mockReturnValue(okAsync(undefined)) as unknown as (
			command: unknown,
		) => ResultAsync<unknown, Error>,
		sseManager: new SseManager(),
		...overrides,
	};
}

function createFetch(deps?: Partial<ServerDeps>) {
	const app = createH3App(makeDeps(deps));
	const handler = toWebHandler(app);
	return (path: string, init?: RequestInit) =>
		handler(new Request(`http://localhost${path}`, init));
}

describe("GET /", () => {
	it("returns 200 with HTML content type", async () => {
		const fetch = createFetch();
		const res = await fetch("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
	});

	it("contains Overview title", async () => {
		const fetch = createFetch();
		const body = await (await fetch("/")).text();
		expect(body).toContain("Overview");
	});

	it("renders overview panel content", async () => {
		const fetch = createFetch();
		const body = await (await fetch("/")).text();
		expect(body).toContain("panel content");
		expect(body).toContain("Test Panel");
	});

	it("contains navigation link to registered page", async () => {
		const fetch = createFetch();
		const body = await (await fetch("/")).text();
		expect(body).toContain("/pages/test-page");
		expect(body).toContain("Test Page");
	});
});

describe("GET /pages/:id", () => {
	it("returns 200 for a valid page", async () => {
		const fetch = createFetch();
		const res = await fetch("/pages/test-page");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
	});

	it("renders the page title", async () => {
		const fetch = createFetch();
		const body = await (await fetch("/pages/test-page")).text();
		expect(body).toContain("Test Page");
	});

	it("renders page panels", async () => {
		const fetch = createFetch();
		const body = await (await fetch("/pages/test-page")).text();
		expect(body).toContain("panel content");
	});

	it("returns 404 for an unknown page", async () => {
		const fetch = createFetch();
		const res = await fetch("/pages/nonexistent");
		expect(res.status).toBe(404);
		const body = await res.text();
		expect(body).toContain("Not Found");
	});
});

describe("GET /panels/:id", () => {
	it("returns 200 with panel fragment for a valid panel", async () => {
		const fetch = createFetch();
		const res = await fetch("/panels/test-panel");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const body = await res.text();
		expect(body).toContain("panel content");
	});

	it("returns 404 for an unknown panel", async () => {
		const fetch = createFetch();
		const res = await fetch("/panels/nonexistent");
		expect(res.status).toBe(404);
	});
});

describe("POST /commands", () => {
	it("dispatches a valid command and returns ok", async () => {
		const dispatchCommand = vi.fn().mockReturnValue(okAsync(undefined));
		const fetch = createFetch({ dispatchCommand });
		const res = await fetch("/commands", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "test.command" }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { ok: boolean };
		expect(json.ok).toBe(true);
		expect(dispatchCommand).toHaveBeenCalledWith(expect.objectContaining({ type: "test.command" }));
	});

	it("returns 400 for missing body type field", async () => {
		const fetch = createFetch();
		const res = await fetch("/commands", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ notType: "bad" }),
		});
		expect(res.status).toBe(400);
	});

	it("returns 500 when command dispatch fails", async () => {
		const dispatchCommand = vi.fn().mockReturnValue(errAsync(new Error("dispatch failed")));
		const fetch = createFetch({ dispatchCommand });
		const res = await fetch("/commands", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "failing.command" }),
		});
		expect(res.status).toBe(500);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("dispatch failed");
	});
});
