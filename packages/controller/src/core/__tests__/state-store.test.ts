import type { InstantiatedPlugin } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { PatchHandler } from "@bluecadet/launchpad-utils/state-patcher";
import { describe, expect, it, vi } from "vitest";
import { StateStore } from "../state-store.js";

function createEmptyStore() {
	return new StateStore(new Map<string, InstantiatedPlugin>());
}

describe("StateStore", () => {
	describe("constructor", () => {
		it("should initialize with default system state", () => {
			const store = createEmptyStore();

			const systemState = store.getSystemState();
			expect(systemState.version).toBe("0.1.0");
			expect(systemState.mode).toBe("task");
			expect(systemState.startTime).toBeInstanceOf(Date);
		});
	});

	describe("getState", () => {
		it("should return aggregated state with system and plugins keys", () => {
			const store = createEmptyStore();

			const state = store.getState();

			expect(state.system).toHaveProperty("version");
			expect(state.system).toHaveProperty("mode");
			expect(state.system).toHaveProperty("startTime");
			expect(state.plugins).toEqual({});
		});

		it("should aggregate state from plugins with getState", () => {
			const mockContentState = { isFetching: true, totalSources: 3 };
			const mockMonitorState = { isConnected: true, totalApps: 5 };

			const plugins = new Map<string, InstantiatedPlugin>([
				["content", { getState: () => mockContentState }],
				["monitor", { getState: () => mockMonitorState }],
			]);

			const store = new StateStore(plugins);
			const state = store.getState();

			expect((state.plugins as any).content).toEqual(mockContentState);
			expect((state.plugins as any).monitor).toEqual(mockMonitorState);
		});

		it("should skip plugins without getState method", () => {
			const plugins = new Map<string, InstantiatedPlugin>([
				["with-state", { getState: () => ({ value: "has-state" }) }],
				["without-state", {}],
			]);

			const store = new StateStore(plugins);
			const state = store.getState();

			expect((state.plugins as any)["with-state"]).toEqual({ value: "has-state" });
			expect((state.plugins as any)["without-state"]).toBeUndefined();
		});
	});

	describe("getPluginState", () => {
		it("should return state for specific plugin", () => {
			const mockState = { value: "test-state" };
			const plugins = new Map<string, InstantiatedPlugin>([
				["test", { getState: () => mockState }],
			]);
			const store = new StateStore(plugins);

			expect(store.getPluginState("test")).toEqual(mockState);
		});

		it("should support typed state retrieval", () => {
			type TestState = { count: number; name: string };
			const mockState: TestState = { count: 42, name: "test" };
			const plugins = new Map<string, InstantiatedPlugin>([
				["test", { getState: () => mockState }],
			]);
			const store = new StateStore(plugins);

			const state = store.getPluginState<TestState>("test");

			expect(state?.count).toBe(42);
			expect(state?.name).toBe("test");
		});

		it("should return undefined for non-existent plugin or one without getState", () => {
			const plugins = new Map<string, InstantiatedPlugin>([["no-state", {}]]);
			const store = new StateStore(plugins);

			expect(store.getPluginState("non-existent")).toBeUndefined();
			expect(store.getPluginState("no-state")).toBeUndefined();
		});
	});

	describe("setSystemState", () => {
		it("should update individual system state properties", () => {
			const store = createEmptyStore();

			(store as any).setSystemState("mode", "persistent");
			expect(store.getSystemState().mode).toBe("persistent");

			const newDate = new Date("2024-01-01");
			(store as any).setSystemState("startTime", newDate);
			expect(store.getSystemState().startTime).toBe(newDate);

			(store as any).setSystemState("version", "1.0.0");
			expect(store.getSystemState().version).toBe("1.0.0");
		});
	});

	describe("pull-based state aggregation", () => {
		it("should query plugins on each getState call and return fresh values", () => {
			let counter = 0;
			const plugin: InstantiatedPlugin = {
				getState: () => ({ value: counter++ }),
			};

			const plugins = new Map<string, InstantiatedPlugin>([["test", plugin]]);
			const store = new StateStore(plugins);

			expect(counter).toBe(0); // not queried yet

			const state1 = store.getState();
			const state2 = store.getState();
			const state3 = store.getState();

			expect((state1.plugins as any).test).toEqual({ value: 0 });
			expect((state2.plugins as any).test).toEqual({ value: 1 });
			expect((state3.plugins as any).test).toEqual({ value: 2 });
		});
	});

	describe("patch handling", () => {
		it("should relay plugin patches with path alteration", () => {
			let patchHandler: PatchHandler | undefined;

			const plugin: InstantiatedPlugin = {
				getState: () => ({ data: { count: 0 } }),
				onStatePatch: (handler) => {
					patchHandler = handler;
					return () => {};
				},
			};

			const plugins = new Map<string, InstantiatedPlugin>([["testSubsystem", plugin]]);
			const store = new StateStore(plugins);

			const onPatchSpy = vi.fn<PatchHandler>();
			store.onPatch(onPatchSpy);

			patchHandler?.([{ op: "replace", path: ["data", "count"], value: 5 }]);

			expect(onPatchSpy).toHaveBeenCalledExactlyOnceWith(
				[{ op: "replace", path: ["plugins", "testSubsystem", "data", "count"], value: 5 }],
				expect.anything(),
			);

			patchHandler?.([
				{ op: "replace", path: ["data", "count"], value: 1 },
				{ op: "add", path: ["data", "newField"], value: 10 },
			]);

			expect(onPatchSpy).toHaveBeenLastCalledWith(
				[
					{
						op: "replace",
						path: ["plugins", "testSubsystem", "data", "count"],
						value: 1,
					},
					{
						op: "add",
						path: ["plugins", "testSubsystem", "data", "newField"],
						value: 10,
					},
				],
				expect.anything(),
			);
		});

		it("should increment version number on patches", () => {
			let patchHandler: PatchHandler | undefined;

			const plugin: InstantiatedPlugin = {
				getState: () => ({ data: { count: 0 } }),
				onStatePatch: (handler) => {
					patchHandler = handler;
					return () => {};
				},
			};

			const plugins = new Map<string, InstantiatedPlugin>([["testSubsystem", plugin]]);
			const store = new StateStore(plugins);

			const onPatchSpy = vi.fn<PatchHandler>();
			store.onPatch(onPatchSpy);

			expect(store.getState()._version).toBe(0);

			patchHandler?.([{ op: "replace", path: ["data", "count"], value: 5 }]);
			expect(onPatchSpy).toHaveBeenCalledWith(expect.anything(), 1);
			expect(store.getState()._version).toBe(1);

			patchHandler?.([
				{ op: "replace", path: ["data", "count"], value: 1 },
				{ op: "add", path: ["data", "newField"], value: 10 },
			]);
			expect(onPatchSpy).toHaveBeenLastCalledWith(expect.anything(), 2);
			expect(store.getState()._version).toBe(2);
		});
	});
});
