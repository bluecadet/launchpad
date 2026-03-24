import type { PatchHandler } from "@bluecadet/launchpad-utils/state-patcher";
import type { InstantiatedSubsystem } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { describe, expect, it, vi } from "vitest";
import { StateStore } from "../state-store.js";

function createEmptyStore() {
	return new StateStore(new Map<string, InstantiatedSubsystem>());
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
		it("should return aggregated state with system and subsystems keys", () => {
			const store = createEmptyStore();

			const state = store.getState();

			expect(state.system).toHaveProperty("version");
			expect(state.system).toHaveProperty("mode");
			expect(state.system).toHaveProperty("startTime");
			expect(state.subsystems).toEqual({});
		});

		it("should aggregate state from subsystems with getState", () => {
			const mockContentState = { isFetching: true, totalSources: 3 };
			const mockMonitorState = { isConnected: true, totalApps: 5 };

			const subsystems = new Map<string, InstantiatedSubsystem>([
				["content", { getState: () => mockContentState }],
				["monitor", { getState: () => mockMonitorState }],
			]);

			const store = new StateStore(subsystems);
			const state = store.getState();

			expect((state.subsystems as any).content).toEqual(mockContentState);
			expect((state.subsystems as any).monitor).toEqual(mockMonitorState);
		});

		it("should skip subsystems without getState method", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>([
				["with-state", { getState: () => ({ value: "has-state" }) }],
				["without-state", {}],
			]);

			const store = new StateStore(subsystems);
			const state = store.getState();

			expect((state.subsystems as any)["with-state"]).toEqual({ value: "has-state" });
			expect((state.subsystems as any)["without-state"]).toBeUndefined();
		});
	});

	describe("getSubsystemState", () => {
		it("should return state for specific subsystem", () => {
			const mockState = { value: "test-state" };
			const subsystems = new Map<string, InstantiatedSubsystem>([
				["test", { getState: () => mockState }],
			]);
			const store = new StateStore(subsystems);

			expect(store.getSubsystemState("test")).toEqual(mockState);
		});

		it("should support typed state retrieval", () => {
			type TestState = { count: number; name: string };
			const mockState: TestState = { count: 42, name: "test" };
			const subsystems = new Map<string, InstantiatedSubsystem>([
				["test", { getState: () => mockState }],
			]);
			const store = new StateStore(subsystems);

			const state = store.getSubsystemState<TestState>("test");

			expect(state?.count).toBe(42);
			expect(state?.name).toBe("test");
		});

		it("should return undefined for non-existent subsystem or one without getState", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>([["no-state", {}]]);
			const store = new StateStore(subsystems);

			expect(store.getSubsystemState("non-existent")).toBeUndefined();
			expect(store.getSubsystemState("no-state")).toBeUndefined();
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
		it("should query subsystems on each getState call and return fresh values", () => {
			let counter = 0;
			const subsystem: InstantiatedSubsystem = {
				getState: () => ({ value: counter++ }),
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["test", subsystem]]);
			const store = new StateStore(subsystems);

			expect(counter).toBe(0); // not queried yet

			const state1 = store.getState();
			const state2 = store.getState();
			const state3 = store.getState();

			expect((state1.subsystems as any).test).toEqual({ value: 0 });
			expect((state2.subsystems as any).test).toEqual({ value: 1 });
			expect((state3.subsystems as any).test).toEqual({ value: 2 });
		});
	});

	describe("patch handling", () => {
		it("should relay subsystem patches with path alteration", () => {
			let patchHandler: PatchHandler | undefined;

			const subsystem: InstantiatedSubsystem = {
				getState: () => ({ data: { count: 0 } }),
				onStatePatch: (handler) => {
					patchHandler = handler;
					return () => {};
				},
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["testSubsystem", subsystem]]);
			const store = new StateStore(subsystems);

			const onPatchSpy = vi.fn<PatchHandler>();
			store.onPatch(onPatchSpy);

			patchHandler?.([{ op: "replace", path: ["data", "count"], value: 5 }]);

			expect(onPatchSpy).toHaveBeenCalledExactlyOnceWith(
				[{ op: "replace", path: ["subsystems", "testSubsystem", "data", "count"], value: 5 }],
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
						path: ["subsystems", "testSubsystem", "data", "count"],
						value: 1,
					},
					{
						op: "add",
						path: ["subsystems", "testSubsystem", "data", "newField"],
						value: 10,
					},
				],
				expect.anything(),
			);
		});

		it("should increment version number on patches", () => {
			let patchHandler: PatchHandler | undefined;

			const subsystem: InstantiatedSubsystem = {
				getState: () => ({ data: { count: 0 } }),
				onStatePatch: (handler) => {
					patchHandler = handler;
					return () => {};
				},
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["testSubsystem", subsystem]]);
			const store = new StateStore(subsystems);

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
