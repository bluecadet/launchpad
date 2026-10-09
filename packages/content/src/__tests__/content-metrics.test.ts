import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import { produce } from "immer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectContentMetrics } from "../content-metrics.js";
import { type ContentState, ContentStateManager } from "../content-state.js";
import { content } from "../launchpad-content.js";
import { defineSource } from "../source.js";

function launchpadState(contentState?: ContentState): LaunchpadState {
	return {
		system: { startTime: new Date(0), mode: "persistent" },
		plugins: contentState ? { content: contentState } : {},
	};
}

describe("content metric observations", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns no observations when content state is missing or null", () => {
		const plugin = content({ sources: [] });

		expect(plugin.observe?.(launchpadState())).toEqual([]);
		expect(projectContentMetrics(null, new Set())).toEqual([]);
	});

	it("projects configured source state, actual success time, and retention gauges", async () => {
		const plugin = content({
			sources: [
				defineSource({
					id: "catalog",
					fetch: () => [],
				}),
			],
		});
		expect(await plugin.setup(createMockPluginCtx())).toBeOk();

		const state: ContentState = {
			phase: "idle",
			versioning: { keepVersions: 3 },
			sourceLastSuccessAt: {
				catalog: new Date("2024-01-02T03:04:05.000Z"),
			},
			sources: {
				catalog: {
					state: "success",
					startTime: new Date("2024-01-02T03:03:00.000Z"),
					finishedAt: new Date("2024-01-02T03:04:05.000Z"),
					duration: 65_000,
				},
				unconfigured: { state: "pending" },
			},
			retention: {
				promotedAt: new Date("2024-01-02T03:05:06.000Z"),
				retainedCount: 4,
				pendingDeleteCount: 2,
				acks: [],
				sweptAt: new Date("2024-01-02T03:06:07.000Z"),
			},
		};

		const observations = plugin.observe?.(launchpadState(state)) ?? [];
		const sourceStates = observations.filter(
			(observation) => observation.name === "launchpad_content_source_state",
		);

		expect(sourceStates).toEqual([
			expect.objectContaining({ value: 0, attributes: { source: "catalog", state: "pending" } }),
			expect.objectContaining({ value: 0, attributes: { source: "catalog", state: "fetching" } }),
			expect.objectContaining({ value: 1, attributes: { source: "catalog", state: "success" } }),
			expect.objectContaining({ value: 0, attributes: { source: "catalog", state: "error" } }),
		]);
		expect(observations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "launchpad_content_source_last_success_seconds",
					value: Date.parse("2024-01-02T03:04:05.000Z") / 1_000,
					unit: "s",
					attributes: { source: "catalog" },
				}),
				expect.objectContaining({
					name: "launchpad_content_active_version_promoted_seconds",
					value: Date.parse("2024-01-02T03:05:06.000Z") / 1_000,
					unit: "s",
				}),
				expect.objectContaining({ name: "launchpad_content_retained_versions", value: 4 }),
				expect.objectContaining({
					name: "launchpad_content_pending_delete_versions",
					value: 2,
				}),
			]),
		);
		expect(observations).toHaveLength(8);
		expect(
			observations.some((observation) => observation.attributes?.source === "unconfigured"),
		).toBe(false);
	});

	it("does not synthesize unavailable success or promotion timestamps", () => {
		const observations = projectContentMetrics(
			{
				phase: "idle",
				versioning: { keepVersions: 3 },
				sources: {
					catalog: {
						state: "success",
						startTime: new Date("2024-01-02T03:03:00.000Z"),
						finishedAt: new Date("2024-01-02T03:04:05.000Z"),
						duration: 65_000,
					},
				},
				retention: {
					retainedCount: 1,
					pendingDeleteCount: 0,
					acks: [],
					sweptAt: new Date(),
				},
			},
			new Set(["catalog"]),
		);

		expect(observations.some((observation) => observation.name.endsWith("_seconds"))).toBe(false);
		expect(observations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "launchpad_content_retained_versions", value: 1 }),
				expect.objectContaining({
					name: "launchpad_content_pending_delete_versions",
					value: 0,
				}),
			]),
		);
	});

	it("retains the latest success timestamp through the next fetching and error states", () => {
		vi.useFakeTimers();
		let state: ContentState = { phase: "idle", sources: {}, versioning: false };
		const stateManager = new ContentStateManager((producer) => {
			state = produce(state, producer);
		});
		stateManager.initializeSources(["catalog"]);

		vi.setSystemTime(new Date("2024-01-02T03:03:00.000Z"));
		stateManager.markSourceFetching("catalog");
		vi.setSystemTime(new Date("2024-01-02T03:04:05.000Z"));
		stateManager.markSourceSuccess("catalog");

		const expectedSeconds = Date.parse("2024-01-02T03:04:05.000Z") / 1_000;
		expect(state.sourceLastSuccessAt?.catalog?.getTime()).toBe(expectedSeconds * 1_000);

		vi.setSystemTime(new Date("2024-01-02T04:00:00.000Z"));
		stateManager.markSourceFetching("catalog");
		expect(projectContentMetrics(state, new Set(["catalog"]))).toContainEqual(
			expect.objectContaining({
				name: "launchpad_content_source_last_success_seconds",
				value: expectedSeconds,
			}),
		);

		stateManager.markSourceError("catalog", new Error("next fetch failed"));
		expect(projectContentMetrics(state, new Set(["catalog"]))).toContainEqual(
			expect.objectContaining({
				name: "launchpad_content_source_last_success_seconds",
				value: expectedSeconds,
			}),
		);
	});
});
