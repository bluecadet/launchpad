import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { describe, expect, it } from "vitest";
import { buildStatusSnapshot } from "../build-status-snapshot.js";

function makeState(overrides?: Partial<LaunchpadState["system"]>): LaunchpadState {
	return {
		system: {
			startTime: new Date("2024-01-01T00:00:00.000Z"),
			mode: "task",
			...overrides,
		},
		plugins: {},
	};
}

function makePlugin(
	name: string,
	summarize?: (state: LaunchpadState) => Section | null,
): PluginConfig {
	return {
		name,
		setup: () => {
			throw new Error("not used in tests");
		},
		...(summarize !== undefined && { summarize }),
	};
}

describe("buildStatusSnapshot", () => {
	it("returns sections sorted by order (lower first)", () => {
		const state = makeState();
		const plugins: PluginConfig[] = [
			makePlugin("b", () => ({ name: "b", order: 30, title: "B", rows: [] })),
			makePlugin("a", () => ({ name: "a", order: 10, title: "A", rows: [] })),
		];

		const snapshot = buildStatusSnapshot(state, plugins);

		expect(snapshot.sections.map((s) => s.name)).toEqual(["a", "b"]);
	});

	it("filters out plugins whose summarize returns null", () => {
		const state = makeState();
		const plugins: PluginConfig[] = [
			makePlugin("present", () => ({ name: "present", title: "Present", rows: [] })),
			makePlugin("absent", () => null),
		];

		const snapshot = buildStatusSnapshot(state, plugins);

		expect(snapshot.sections).toHaveLength(1);
		expect(snapshot.sections[0]?.name).toBe("present");
	});

	it("skips plugins without a summarize property", () => {
		const state = makeState();
		const plugins: PluginConfig[] = [
			makePlugin("no-summarize"),
			makePlugin("has-summarize", () => ({ name: "has-summarize", title: "Has", rows: [] })),
		];

		const snapshot = buildStatusSnapshot(state, plugins);

		expect(snapshot.sections).toHaveLength(1);
		expect(snapshot.sections[0]?.name).toBe("has-summarize");
	});

	it("includes ISO start time, non-negative uptimeMs, and system mode in header", () => {
		const startTime = new Date("2024-06-15T12:00:00.000Z");
		const state = makeState({ startTime, mode: "persistent" });

		const snapshot = buildStatusSnapshot(state, []);

		expect(snapshot.header.startTime).toBe("2024-06-15T12:00:00.000Z");
		expect(snapshot.header.uptimeMs).toBeGreaterThanOrEqual(0);
		expect(snapshot.header.mode).toBe("persistent");
	});

	it("uptimeMs is non-negative even when startTime is in the future", () => {
		const futureStart = new Date(Date.now() + 60_000);
		const state = makeState({ startTime: futureStart });

		const snapshot = buildStatusSnapshot(state, []);

		expect(snapshot.header.uptimeMs).toBe(0);
	});

	it("composes sections from multiple plugins into a single snapshot", () => {
		const state = makeState();
		const plugins: PluginConfig[] = [
			makePlugin("content", () => ({
				name: "content",
				order: 10,
				title: "Content",
				rows: [{ type: "kv", label: "Status", value: "ok" }],
			})),
			makePlugin("monitor", () => ({
				name: "monitor",
				order: 20,
				title: "Monitor",
				rows: [{ type: "text", text: "All good" }],
			})),
			makePlugin("dashboard", () => ({
				name: "dashboard",
				order: 30,
				title: "Dashboard",
				rows: [],
			})),
		];

		const snapshot = buildStatusSnapshot(state, plugins);

		expect(snapshot.sections).toHaveLength(3);
		expect(snapshot.sections.map((s) => s.name)).toEqual(["content", "monitor", "dashboard"]);
		expect(snapshot.sections[0]?.rows).toHaveLength(1);
	});

	it("defaults order to 50 when not specified, sorting stably among defaults", () => {
		const state = makeState();
		const plugins: PluginConfig[] = [
			makePlugin("high", () => ({ name: "high", order: 100, title: "High", rows: [] })),
			makePlugin("default1", () => ({ name: "default1", title: "Default1", rows: [] })),
			makePlugin("low", () => ({ name: "low", order: 5, title: "Low", rows: [] })),
		];

		const snapshot = buildStatusSnapshot(state, plugins);

		const names = snapshot.sections.map((s) => s.name);
		expect(names.indexOf("low")).toBeLessThan(names.indexOf("default1"));
		expect(names.indexOf("default1")).toBeLessThan(names.indexOf("high"));
	});
});
