import type { PatchHandler } from "@bluecadet/launchpad-utils/state-patcher";
import type { InstantiatedSubsystem } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { Patch } from "immer";
import { describe, expect, it, vi } from "vitest";
import { StateStore } from "../state-store.js";

describe("StateStore", () => {
	describe("constructor", () => {
		it("should initialize with default system state", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			const systemState = store.getSystemState();
			expect(systemState.version).toBe("0.1.0");
			expect(systemState.mode).toBe("task");
			expect(systemState.startTime).toBeInstanceOf(Date);
		});
	});

	describe("getState", () => {
		it("should return aggregated state with system and subsystems", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			const state = store.getState();

			expect(state).toHaveProperty("system");
			expect(state).toHaveProperty("subsystems");
			expect(state.system).toHaveProperty("version");
			expect(state.system).toHaveProperty("mode");
			expect(state.system).toHaveProperty("startTime");
		});

		it("should aggregate state from subsystems with getState", () => {
			const mockContentState = { isFetching: true, totalSources: 3 };
			const mockMonitorState = { isConnected: true, totalApps: 5 };

			const contentSubsystem: InstantiatedSubsystem = {
				getState: () => mockContentState,
			};

			const monitorSubsystem: InstantiatedSubsystem = {
				getState: () => mockMonitorState,
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([
				["content", contentSubsystem],
				["monitor", monitorSubsystem],
			]);

			const store = new StateStore(subsystems);
			const state = store.getState();

			expect((state.subsystems as any).content).toEqual(mockContentState);
			expect((state.subsystems as any).monitor).toEqual(mockMonitorState);
		});

		it("should skip subsystems without getState method", () => {
			const subsystemWithState: InstantiatedSubsystem = {
				getState: () => ({ value: "has-state" }),
			};

			const subsystemWithoutState: InstantiatedSubsystem = {
				// No getState method
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([
				["with-state", subsystemWithState],
				["without-state", subsystemWithoutState],
			]);

			const store = new StateStore(subsystems);
			const state = store.getState();

			expect((state.subsystems as any)["with-state"]).toEqual({ value: "has-state" });
			expect((state.subsystems as any)["without-state"]).toBeUndefined();
		});

		it("should return empty subsystems object when no subsystems registered", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			const state = store.getState();

			expect(state.subsystems).toEqual({});
		});
	});

	describe("getSubsystemState", () => {
		it("should return state for specific subsystem", () => {
			const mockState = { value: "test-state" };
			const subsystem: InstantiatedSubsystem = {
				getState: () => mockState,
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["test", subsystem]]);
			const store = new StateStore(subsystems);

			const state = store.getSubsystemState("test");

			expect(state).toEqual(mockState);
		});

		it("should return undefined for non-existent subsystem", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			const state = store.getSubsystemState("non-existent");

			expect(state).toBeUndefined();
		});

		it("should return undefined for subsystem without getState", () => {
			const subsystem: InstantiatedSubsystem = {
				// No getState method
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["test", subsystem]]);
			const store = new StateStore(subsystems);

			const state = store.getSubsystemState("test");

			expect(state).toBeUndefined();
		});

		it("should support typed state retrieval", () => {
			type TestState = { count: number; name: string };

			const mockState: TestState = { count: 42, name: "test" };
			const subsystem: InstantiatedSubsystem = {
				getState: () => mockState,
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["test", subsystem]]);
			const store = new StateStore(subsystems);

			const state = store.getSubsystemState<TestState>("test");

			// TypeScript should infer the type
			expect(state?.count).toBe(42);
			expect(state?.name).toBe("test");
		});
	});

	describe("getSystemState", () => {
		it("should return system-level state", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			const systemState = store.getSystemState();

			expect(systemState).toHaveProperty("version");
			expect(systemState).toHaveProperty("mode");
			expect(systemState).toHaveProperty("startTime");
		});
	});

	describe("setSystemState", () => {
		it("should update system state property", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			(store as any).setSystemState("mode", "persistent");

			const systemState = store.getSystemState();
			expect(systemState.mode).toBe("persistent");
		});

		it("should update startTime", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			const newDate = new Date("2024-01-01");
			(store as any).setSystemState("startTime", newDate);

			const systemState = store.getSystemState();
			expect(systemState.startTime).toBe(newDate);
		});

		it("should update version", () => {
			const subsystems = new Map<string, InstantiatedSubsystem>();
			const store = new StateStore(subsystems);

			(store as any).setSystemState("version", "1.0.0");

			const systemState = store.getSystemState();
			expect(systemState.version).toBe("1.0.0");
		});
	});

	describe("pull-based state aggregation", () => {
		it("should query subsystems on demand, not via subscriptions", () => {
			let callCount = 0;
			const subsystem: InstantiatedSubsystem = {
				getState: () => {
					callCount++;
					return { callCount };
				},
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["test", subsystem]]);
			const store = new StateStore(subsystems);

			// State should not be queried until getState is called
			expect(callCount).toBe(0);

			store.getState();
			expect(callCount).toBe(1);

			store.getState();
			expect(callCount).toBe(2);
		});

		it("should always return current state from subsystems", () => {
			let counter = 0;
			const subsystem: InstantiatedSubsystem = {
				getState: () => ({ value: counter++ }),
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["test", subsystem]]);
			const store = new StateStore(subsystems);

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
				getState: () => {
					return { data: { count: 0 } };
				},
				onStatePatch: (handler) => {
					patchHandler = handler;
					return () => {};
				},
			};

			const subsystems = new Map<string, InstantiatedSubsystem>([["testSubsystem", subsystem]]);
			const store = new StateStore(subsystems);

			const onPatchSpy = vi.fn<PatchHandler>();
			store.onPatch(onPatchSpy);

			// Simulate a patch from the subsystem
			let patches: Patch[] = [{ op: "replace", path: ["data", "count"], value: 5 }];

			patchHandler?.(patches);

			expect(onPatchSpy).toHaveBeenCalledExactlyOnceWith(
				[
					{
						op: "replace",
						path: ["subsystems", "testSubsystem", "data", "count"],
						value: 5,
					},
				],
				expect.anything(),
			);

			// Simulate a patch from the subsystem
			patches = [
				{ op: "replace", path: ["data", "count"], value: 1 },
				{ op: "add", path: ["data", "newField"], value: 10 },
			];

			patchHandler?.(patches);

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
				getState: () => {
					return { data: { count: 0 } };
				},
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

			// Simulate a patch from the subsystem
			let patches: Patch[] = [{ op: "replace", path: ["data", "count"], value: 5 }];

			patchHandler?.(patches);

			expect(onPatchSpy).toHaveBeenCalledWith(expect.anything(), 1);

			expect(store.getState()._version).toBe(1);

			// Simulate a patch from the subsystem
			patches = [
				{ op: "replace", path: ["data", "count"], value: 1 },
				{ op: "add", path: ["data", "newField"], value: 10 },
			];

			patchHandler?.(patches);

			expect(onPatchSpy).toHaveBeenLastCalledWith(expect.anything(), 2);

			expect(store.getState()._version).toBe(2);
		});
	});
});
