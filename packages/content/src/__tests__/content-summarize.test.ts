import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import { describe, expect, it } from "vitest";
import type { ContentState } from "../content-state.js";
import { buildContentSection } from "../content-summarize.js";

function makeState(contentState?: ContentState): LaunchpadState {
	return {
		system: { startTime: new Date(), mode: "task" },
		plugins: contentState ? { content: contentState } : {},
	};
}

describe("buildContentSection", () => {
	it("returns null-safe: plugin state absent means no section", () => {
		const state = makeState();
		const contentState = state.plugins.content;
		expect(contentState).toBeUndefined();
	});

	it("returns a Section with correct metadata", () => {
		const section = buildContentSection({ phase: "idle", sources: {} });
		expect(section.name).toBe("content");
		expect(section.order).toBe(20);
		expect(section.title).toBe("Content");
	});

	it("includes Phase kv row", () => {
		const section = buildContentSection({ phase: "fetching-sources", sources: {} });
		const phaseRow = section.rows.find((r) => r.type === "kv" && r.label === "Phase");
		expect(phaseRow).toMatchObject({ type: "kv", label: "Phase", value: "fetching-sources" });
	});

	it("omits Sources list row when sources is empty", () => {
		const section = buildContentSection({ phase: "idle", sources: {} });
		const sourcesRow = section.rows.find((r) => r.type === "list" && r.label === "Sources");
		expect(sourcesRow).toBeUndefined();
	});

	it("includes Sources list row when sources are present", () => {
		const section = buildContentSection({
			phase: "idle",
			sources: { site: { state: "pending" } },
		});
		const sourcesRow = section.rows.find((r) => r.type === "list" && r.label === "Sources");
		expect(sourcesRow).toBeDefined();
		expect(sourcesRow?.type).toBe("list");
	});

	it("maps pending source to neutral tone", () => {
		const section = buildContentSection({
			phase: "idle",
			sources: { site: { state: "pending" } },
		});
		const sourcesRow = section.rows.find((r) => r.type === "list");
		if (!sourcesRow || sourcesRow.type !== "list") throw new Error("expected list row");
		expect(sourcesRow.items[0]).toMatchObject({
			type: "kv",
			label: "site",
			value: "Pending",
			tone: "neutral",
		});
	});

	it("maps fetching source to warn tone", () => {
		const section = buildContentSection({
			phase: "fetching-sources",
			sources: { site: { state: "fetching", startTime: new Date() } },
		});
		const sourcesRow = section.rows.find((r) => r.type === "list");
		if (!sourcesRow || sourcesRow.type !== "list") throw new Error("expected list row");
		expect(sourcesRow.items[0]).toMatchObject({
			type: "kv",
			label: "site",
			value: "Fetching",
			tone: "warn",
		});
	});

	it("maps success source to ok tone with duration", () => {
		const startTime = new Date(0);
		const finishedAt = new Date(400);
		const section = buildContentSection({
			phase: "idle",
			sources: {
				site: {
					state: "success",
					startTime,
					finishedAt,
					duration: 400,
				},
			},
		});
		const sourcesRow = section.rows.find((r) => r.type === "list");
		if (!sourcesRow || sourcesRow.type !== "list") throw new Error("expected list row");
		expect(sourcesRow.items[0]).toMatchObject({
			type: "kv",
			label: "site",
			value: "Success (0.4s)",
			tone: "ok",
		});
	});

	it("maps error source to error tone", () => {
		const section = buildContentSection({
			phase: "error",
			error: new Error("fetch failed") as never,
			restored: false,
			sources: {
				other: {
					state: "error",
					error: new Error("fetch failed"),
					attemptedAt: new Date(),
					restored: false,
				},
			},
		});
		const sourcesRow = section.rows.find((r) => r.type === "list");
		if (!sourcesRow || sourcesRow.type !== "list") throw new Error("expected list row");
		expect(sourcesRow.items[0]).toMatchObject({
			type: "kv",
			label: "other",
			value: "Error: fetch failed",
			tone: "error",
		});
	});

	it("appends restored suffix for error sources with restored: true", () => {
		const section = buildContentSection({
			phase: "idle",
			sources: {
				other: {
					state: "error",
					error: new Error("fetch failed"),
					attemptedAt: new Date(),
					restored: true,
				},
			},
		});
		const sourcesRow = section.rows.find((r) => r.type === "list");
		if (!sourcesRow || sourcesRow.type !== "list") throw new Error("expected list row");
		expect(sourcesRow.items[0]).toMatchObject({
			type: "kv",
			label: "other",
			value: "Error: fetch failed (restored from backup)",
			tone: "error",
		});
	});
});

describe("content plugin summarize wiring", () => {
	it("summarize returns null when content state is absent", async () => {
		const { content } = await import("../launchpad-content.js");
		const plugin = content({ sources: [] });
		const state = makeState();
		expect(plugin.summarize?.(state)).toBeNull();
	});

	it("summarize returns Section when content state is present", async () => {
		const { content } = await import("../launchpad-content.js");
		const plugin = content({ sources: [] });
		const state = makeState({ phase: "idle", sources: {} });
		const section = plugin.summarize?.(state);
		expect(section).toMatchObject({ name: "content", title: "Content" });
	});
});
