import type { PatchHandlerWithVersion } from "@bluecadet/launchpad-utils/state-patcher";
import { describe, expect, it, vi } from "vitest";
import { StateStore } from "../state-store.js";

function createEmptyStore() {
	return new StateStore();
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

		it("should accept a mode option", () => {
			const store = new StateStore("persistent");
			expect(store.getSystemState().mode).toBe("persistent");
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

		it("should aggregate state from registered plugins", () => {
			const store = createEmptyStore();

			const updateContent = store.getPluginUpdater("content");
			const updateMonitor = store.getPluginUpdater("monitor");

			updateContent(() => ({ isFetching: true, totalSources: 3 }));
			updateMonitor(() => ({ isConnected: true, totalApps: 5 }));

			const state = store.getState();

			expect((state.plugins as Record<string, unknown>).content).toEqual({
				isFetching: true,
				totalSources: 3,
			});
			expect((state.plugins as Record<string, unknown>).monitor).toEqual({
				isConnected: true,
				totalApps: 5,
			});
		});

		it("should reflect state changes made via the returned updater", () => {
			const store = createEmptyStore();
			const update = store.getPluginUpdater("content");

			update(() => ({ isFetching: false, totalSources: 0 }));

			update((draft: { isFetching: boolean; totalSources: number }) => {
				draft.isFetching = true;
				draft.totalSources = 7;
			});

			const state = store.getState();
			expect((state.plugins as Record<string, unknown>).content).toEqual({
				isFetching: true,
				totalSources: 7,
			});
		});
	});

	describe("getPluginState", () => {
		it("should return state for a specific plugin", () => {
			const store = createEmptyStore();
			const update = store.getPluginUpdater("test");
			update(() => ({ value: "initial" }));

			expect(store.getPluginState("test")).toEqual({ value: "initial" });
		});

		it("should support typed state retrieval", () => {
			type TestState = { count: number; name: string };
			const store = createEmptyStore();
			const update = store.getPluginUpdater("test");
			update(() => ({ count: 42, name: "test" }) satisfies TestState);

			const state = store.getPluginState<TestState>("test");

			expect(state?.count).toBe(42);
			expect(state?.name).toBe("test");
		});

		it("should return the latest state after an update", () => {
			type TestState = { count: number };
			const store = createEmptyStore();
			const update = store.getPluginUpdater("test");

			update(() => ({ count: 0 }) satisfies TestState);

			update((draft: TestState) => {
				draft.count = 99;
			});

			expect(store.getPluginState<TestState>("test")?.count).toBe(99);
		});

		it("should return undefined for a non-existent plugin", () => {
			const store = createEmptyStore();

			expect(store.getPluginState("non-existent")).toBeUndefined();
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

	describe("patch handling", () => {
		it("should relay plugin patches with adjusted paths", () => {
			const store = createEmptyStore();
			const update = store.getPluginUpdater("testSubsystem");

			update(() => ({ data: { count: 0 } }));

			const onPatchSpy = vi.fn<PatchHandlerWithVersion>();
			store.onPatch(onPatchSpy);

			update((draft: { data: { count: number } }) => {
				draft.data.count = 5;
			});

			expect(onPatchSpy).toHaveBeenCalledExactlyOnceWith(
				[{ op: "replace", path: ["plugins", "testSubsystem", "data", "count"], value: 5 }],
				expect.anything(),
			);
		});

		it("should relay multiple patches in one update", () => {
			const store = createEmptyStore();
			const update = store.getPluginUpdater("testSubsystem");

			update(() => ({ data: { count: 0, newField: undefined as number | undefined } }));

			const onPatchSpy = vi.fn<PatchHandlerWithVersion>();
			store.onPatch(onPatchSpy);

			update((draft: { data: { count: number; newField: number | undefined } }) => {
				draft.data.count = 1;
				draft.data.newField = 10;
			});

			const [patches] = onPatchSpy.mock.calls[0];
			const countPatch = patches.find((p) => p.path.at(-1) === "count");
			const newFieldPatch = patches.find((p) => p.path.at(-1) === "newField");

			expect(countPatch).toMatchObject({
				op: "replace",
				path: ["plugins", "testSubsystem", "data", "count"],
				value: 1,
			});
			expect(newFieldPatch).toMatchObject({
				path: ["plugins", "testSubsystem", "data", "newField"],
				value: 10,
			});
		});

		it("should increment version number on each patch emission", () => {
			const store = createEmptyStore();
			const update = store.getPluginUpdater("testSubsystem");

			update(() => ({ data: { count: 0 } }));

			const onPatchSpy = vi.fn<PatchHandlerWithVersion>();
			store.onPatch(onPatchSpy);

			expect(store.getState()._version).toBe(1);

			update((draft: { data: { count: number } }) => {
				draft.data.count = 5;
			});
			expect(onPatchSpy).toHaveBeenCalledWith(expect.anything(), 2);
			expect(store.getState()._version).toBe(2);

			update((draft: { data: { count: number } }) => {
				draft.data.count = 6;
			});
			expect(onPatchSpy).toHaveBeenLastCalledWith(expect.anything(), 3);
			expect(store.getState()._version).toBe(3);
		});

		it("should not emit patches when the state does not change", () => {
			const store = createEmptyStore();
			const update = store.getPluginUpdater("testSubsystem");

			update(() => ({ data: { count: 0 } }));

			const onPatchSpy = vi.fn<PatchHandlerWithVersion>();
			store.onPatch(onPatchSpy);

			// Immer will not emit patches when nothing changes
			update((_draft) => {
				// no-op
			});

			expect(onPatchSpy).not.toHaveBeenCalled();
		});

		it("should support unsubscribing from patches", () => {
			const store = createEmptyStore();
			const update = store.getPluginUpdater("testSubsystem");

			update(() => ({ data: { count: 0 } }));

			const onPatchSpy = vi.fn<PatchHandlerWithVersion>();
			const unsubscribe = store.onPatch(onPatchSpy);

			update((draft: { data: { count: number } }) => {
				draft.data.count = 1;
			});
			expect(onPatchSpy).toHaveBeenCalledTimes(1);

			unsubscribe();

			update((draft: { data: { count: number } }) => {
				draft.data.count = 2;
			});
			expect(onPatchSpy).toHaveBeenCalledTimes(1); // still 1, not called again
		});
	});
});
