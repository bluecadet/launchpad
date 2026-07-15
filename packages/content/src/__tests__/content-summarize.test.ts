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
		const section = buildContentSection({ phase: "idle", sources: {}, versioning: false });
		expect(section.name).toBe("content");
		expect(section.order).toBe(20);
		expect(section.title).toBe("Content");
	});

	it("includes Phase kv row", () => {
		const section = buildContentSection({
			phase: "fetching-sources",
			sources: {},
			versioning: false,
		});
		const phaseRow = section.rows.find((r) => r.type === "kv" && r.label === "Phase");
		expect(phaseRow).toMatchObject({ type: "kv", label: "Phase", value: "fetching-sources" });
	});

	it("renders no Version/Retained rows when the versioning snapshot is false", () => {
		const section = buildContentSection({ phase: "idle", sources: {}, versioning: false });
		expect(
			section.rows.some(
				(row) => row.type === "kv" && (row.label === "Version" || row.label === "Retained"),
			),
		).toBe(false);
	});

	it("renders no Version/Retained rows when the versioning snapshot is absent (legacy/defensive state)", () => {
		// Simulates a ContentState that predates the versioning field, or a partial patch that
		// hasn't applied it yet. buildContentSection must not crash and must render exactly like
		// the versioning-off path.
		const legacyState = { phase: "idle", sources: {} } as unknown as ContentState;
		const section = buildContentSection(legacyState);
		expect(
			section.rows.some(
				(row) => row.type === "kv" && (row.label === "Version" || row.label === "Retained"),
			),
		).toBe(false);
	});

	it("shows none-yet versioning status before the first fetch", () => {
		const section = buildContentSection(
			{ phase: "idle", sources: {}, versioning: { keepVersions: 3 } },
			new Date("2026-07-14T15:34:45Z"),
		);

		expect(section.rows).toContainEqual({
			type: "kv",
			label: "Version",
			value: "none yet",
			tone: "neutral",
		});
		expect(section.rows).toContainEqual({
			type: "kv",
			label: "Retained",
			value: "0 versions (keep 3)",
			tone: "ok",
		});
		expect(section.rows.some((row) => row.type === "list" && row.label === "Acks")).toBe(false);
	});

	it("renders the versioning rows purely from state (no second argument besides `now`)", () => {
		const section = buildContentSection(
			{
				phase: "idle",
				sources: {},
				versioning: { keepVersions: 3 },
				retention: {
					versionId: "20260714T153045Z",
					promotedAt: new Date("2026-07-14T15:30:45Z"),
					retainedCount: 1,
					pendingDeleteCount: 0,
					acks: [],
					sweptAt: new Date("2026-07-14T15:30:46Z"),
				},
			},
			new Date("2026-07-14T15:34:45Z"),
		);

		expect(section.rows).toContainEqual({
			type: "kv",
			label: "Version",
			value: "20260714T153045Z · promoted 4m ago",
			tone: "ok",
		});
		expect(section.rows).toContainEqual({
			type: "kv",
			label: "Retained",
			value: "1 version (keep 3)",
			tone: "ok",
		});
	});

	it("shows the active version and pending deletions", () => {
		const section = buildContentSection(
			{
				phase: "idle",
				sources: {},
				versioning: { keepVersions: 3 },
				retention: {
					versionId: "20260714T153045Z",
					promotedAt: new Date("2026-07-14T15:30:45Z"),
					retainedCount: 3,
					pendingDeleteCount: 2,
					acks: [],
					sweptAt: new Date("2026-07-14T15:30:46Z"),
				},
			},
			new Date("2026-07-14T15:34:45Z"),
		);

		expect(section.rows).toContainEqual({
			type: "kv",
			label: "Version",
			value: "20260714T153045Z · promoted 4m ago",
			tone: "ok",
		});
		expect(section.rows).toContainEqual({
			type: "kv",
			label: "Retained",
			value: "5 versions (keep 3, 2 pending delete)",
			tone: "warn",
		});
	});

	it("shows fresh ack leases", () => {
		const section = buildContentSection(
			{
				phase: "idle",
				sources: {},
				versioning: { keepVersions: 3 },
				retention: {
					retainedCount: 3,
					pendingDeleteCount: 0,
					acks: [
						{
							consumerId: "kiosk-1",
							versionId: "20260714T153045Z",
							ackedAt: new Date("2026-07-14T15:32:45Z"),
							fresh: true,
						},
					],
					sweptAt: new Date("2026-07-14T15:32:46Z"),
				},
			},
			new Date("2026-07-14T15:34:45Z"),
		);

		expect(section.rows).toContainEqual({
			type: "list",
			label: "Acks",
			items: [
				{
					type: "kv",
					label: "kiosk-1",
					value: "20260714T153045Z · 2m ago",
					tone: "ok",
				},
			],
		});
	});

	it("shows expired ack leases neutrally", () => {
		const section = buildContentSection(
			{
				phase: "idle",
				sources: {},
				versioning: { keepVersions: 3 },
				retention: {
					retainedCount: 3,
					pendingDeleteCount: 0,
					acks: [
						{
							consumerId: "kiosk-1",
							versionId: "20260714T153045Z",
							ackedAt: new Date("2026-07-14T12:34:45Z"),
							fresh: false,
						},
					],
					sweptAt: new Date("2026-07-14T12:34:46Z"),
				},
			},
			new Date("2026-07-14T15:34:45Z"),
		);

		expect(section.rows).toContainEqual({
			type: "list",
			label: "Acks",
			items: [
				{
					type: "kv",
					label: "kiosk-1",
					value: "20260714T153045Z · expired 3h ago",
					tone: "neutral",
				},
			],
		});
	});

	it("omits Sources list row when sources is empty", () => {
		const section = buildContentSection({ phase: "idle", sources: {}, versioning: false });
		const sourcesRow = section.rows.find((r) => r.type === "list" && r.label === "Sources");
		expect(sourcesRow).toBeUndefined();
	});

	it("includes Sources list row when sources are present", () => {
		const section = buildContentSection({
			phase: "idle",
			sources: { site: { state: "pending" } },
			versioning: false,
		});
		const sourcesRow = section.rows.find((r) => r.type === "list" && r.label === "Sources");
		expect(sourcesRow).toBeDefined();
		expect(sourcesRow?.type).toBe("list");
	});

	it("maps pending source to neutral tone", () => {
		const section = buildContentSection({
			phase: "idle",
			sources: { site: { state: "pending" } },
			versioning: false,
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
			versioning: false,
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
			versioning: false,
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
			versioning: false,
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
			versioning: false,
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
		const state = makeState({ phase: "idle", sources: {}, versioning: false });
		const section = plugin.summarize?.(state);
		expect(section).toMatchObject({ name: "content", title: "Content" });
		expect(
			section?.rows.some(
				(row) => row.type === "kv" && (row.label === "Version" || row.label === "Retained"),
			),
		).toBe(false);
	});

	it("renders versioning rows purely from the state passed to summarize, without requiring setup to have run first", async () => {
		const { content } = await import("../launchpad-content.js");
		const plugin = content({ sources: [] });
		// Note: setup() is deliberately not called here. summarize must read the versioning
		// snapshot from the state it's given, not from any setup-time closure.
		const state = makeState({ phase: "idle", sources: {}, versioning: { keepVersions: 3 } });
		const section = plugin.summarize?.(state);
		expect(section?.rows).toContainEqual({
			type: "kv",
			label: "Retained",
			value: "0 versions (keep 3)",
			tone: "ok",
		});
	});
});
