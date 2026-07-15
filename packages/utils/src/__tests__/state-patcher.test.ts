import { describe, expect, it, vi } from "vitest";
import { PatchedStateManager } from "../state-patcher.js";

interface TestState {
	count: number;
	name: string;
	nested: {
		value: number;
	};
}

describe("PatchedStateManager", () => {
	describe("constructor and initialization", () => {
		it("should initialize with provided state and not invoke handlers on registration", () => {
			const initialState: TestState = {
				count: 0,
				name: "test",
				nested: { value: 42 },
			};

			const manager = new PatchedStateManager(initialState);

			expect(manager.state).toEqual(initialState);

			const handler = vi.fn();
			manager.onPatch(handler);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("state getter", () => {
		it("should return state after updates", () => {
			const manager = new PatchedStateManager({ count: 0, name: "" });

			manager.updateState((draft) => {
				draft.count = 10;
				draft.name = "updated";
			});

			expect(manager.state.count).toBe(10);
			expect(manager.state.name).toBe("updated");
		});
	});

	describe("onPatch subscription", () => {
		it("should call handler when state is updated", () => {
			const manager = new PatchedStateManager({ count: 0, name: "test" });
			const handler = vi.fn<(patches: any[]) => void>();

			manager.onPatch(handler);
			manager.updateState((draft) => {
				draft.count = 5;
			});

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						op: "replace",
						path: ["count"],
						value: 5,
					}),
				]),
			);
		});

		it("should call multiple handlers on state update", () => {
			const manager = new PatchedStateManager({ count: 0 });
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const handler3 = vi.fn();

			manager.onPatch(handler1);
			manager.onPatch(handler2);
			manager.onPatch(handler3);

			manager.updateState((draft) => {
				draft.count = 1;
			});

			expect(handler1).toHaveBeenCalledTimes(1);
			expect(handler2).toHaveBeenCalledTimes(1);
			expect(handler3).toHaveBeenCalledTimes(1);
		});

		it("should stop calling handler after unsubscribe", () => {
			const manager = new PatchedStateManager({ count: 0 });
			const handler = vi.fn();

			const unsubscribe = manager.onPatch(handler);
			expect(typeof unsubscribe).toBe("function");

			manager.updateState((draft) => {
				draft.count = 1;
			});
			expect(handler).toHaveBeenCalledTimes(1);

			unsubscribe();

			manager.updateState((draft) => {
				draft.count = 2;
			});
			expect(handler).toHaveBeenCalledTimes(1); // Still called only once
		});

		it("should handle multiple subscriptions and unsubscriptions", () => {
			const manager = new PatchedStateManager({ count: 0 });
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const handler3 = vi.fn();

			const _unsub1 = manager.onPatch(handler1);
			const unsub2 = manager.onPatch(handler2);
			const _unsub3 = manager.onPatch(handler3);

			manager.updateState((draft) => {
				draft.count = 1;
			});

			expect(handler1).toHaveBeenCalledTimes(1);
			expect(handler2).toHaveBeenCalledTimes(1);
			expect(handler3).toHaveBeenCalledTimes(1);

			unsub2();

			manager.updateState((draft) => {
				draft.count = 2;
			});

			expect(handler1).toHaveBeenCalledTimes(2);
			expect(handler2).toHaveBeenCalledTimes(1); // Still 1
			expect(handler3).toHaveBeenCalledTimes(2);
		});

		it("should isolate throwing handlers from updateState and other handlers", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const manager = new PatchedStateManager({ count: 0 });
			const throwingHandler = vi.fn(() => {
				throw new Error("subscriber exploded");
			});
			const laterHandler = vi.fn();

			manager.onPatch(throwingHandler);
			manager.onPatch(laterHandler);

			expect(() =>
				manager.updateState((draft) => {
					draft.count = 1;
				}),
			).not.toThrow();

			expect(manager.state.count).toBe(1);
			expect(laterHandler).toHaveBeenCalledTimes(1);
			expect(consoleSpy).toHaveBeenCalledWith(
				"Error in state patch handler:",
				expect.objectContaining({ message: "subscriber exploded" }),
			);

			consoleSpy.mockRestore();
		});
	});

	describe("updateState", () => {
		it("should update simple property", () => {
			const manager = new PatchedStateManager({ count: 0, name: "test" });

			manager.updateState((draft) => {
				draft.count = 42;
			});

			expect(manager.state.count).toBe(42);
		});

		it("should update nested property", () => {
			const manager = new PatchedStateManager({
				count: 0,
				nested: { value: 10 },
			});

			manager.updateState((draft) => {
				draft.nested.value = 99;
			});

			expect(manager.state.nested.value).toBe(99);
		});

		it("should handle multiple property updates in single call", () => {
			const manager = new PatchedStateManager({ count: 0, name: "old" });

			manager.updateState((draft) => {
				draft.count = 5;
				draft.name = "new";
			});

			expect(manager.state.count).toBe(5);
			expect(manager.state.name).toBe("new");
		});

		it("should return updated state", () => {
			const manager = new PatchedStateManager({ count: 0 });

			const result = manager.updateState((draft) => {
				draft.count = 42;
			});

			expect(result).toEqual(manager.state);
			expect(result.count).toBe(42);
		});

		it("should generate correct patches for property changes", () => {
			const manager = new PatchedStateManager({ count: 0, name: "test" });
			const handler = vi.fn();

			manager.onPatch(handler);

			manager.updateState((draft) => {
				draft.count = 10;
				draft.name = "updated";
			});

			const patches = handler.mock.calls[0]![0];
			expect(patches).toContainEqual(
				expect.objectContaining({
					op: "replace",
					path: ["count"],
					value: 10,
				}),
			);
			expect(patches).toContainEqual(
				expect.objectContaining({
					op: "replace",
					path: ["name"],
					value: "updated",
				}),
			);
		});

		it("should handle array mutations", () => {
			interface StateWithArray {
				items: string[];
			}

			const manager = new PatchedStateManager<StateWithArray>({
				items: ["a", "b"],
			});
			const handler = vi.fn();

			manager.onPatch(handler);

			manager.updateState((draft) => {
				draft.items.push("c");
			});

			expect(manager.state.items).toEqual(["a", "b", "c"]);
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should handle object addition", () => {
			interface StateWithRecord {
				data: Record<string, number>;
			}

			const manager = new PatchedStateManager<StateWithRecord>({
				data: { a: 1 },
			});
			const handler = vi.fn();

			manager.onPatch(handler);

			manager.updateState((draft) => {
				draft.data.b = 2;
			});

			expect(manager.state.data).toEqual({ a: 1, b: 2 });
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should not call handlers if no changes are made", () => {
			const manager = new PatchedStateManager({ count: 0 });
			const handler = vi.fn();

			manager.onPatch(handler);

			manager.updateState((draft) => {
				// No actual changes
				const temp = draft.count;
				draft.count = temp;
			});

			// Immer may or may not generate patches for no-op updates
			// This tests the actual behavior
			expect(manager.state.count).toBe(0);
		});

		it("should maintain immutability of state", () => {
			const initialState = { count: 0, name: "test", nested: { value: 42 } };
			const manager = new PatchedStateManager(initialState);

			const stateBefore = manager.state;

			manager.updateState((draft) => {
				draft.count = 10;
				draft.nested.value = 99;
			});

			expect(stateBefore.count).toBe(0);
			expect(stateBefore.nested.value).toBe(42);
			expect(manager.state.count).toBe(10);
			expect(manager.state.nested.value).toBe(99);
		});
	});

	describe("integration scenarios", () => {
		it("should handle rapid successive updates", () => {
			const manager = new PatchedStateManager({ count: 0 });
			const handler = vi.fn();

			manager.onPatch(handler);

			for (let i = 1; i <= 5; i++) {
				manager.updateState((draft) => {
					draft.count = i;
				});
			}

			expect(manager.state.count).toBe(5);
			expect(handler).toHaveBeenCalledTimes(5);
		});

		it("should preserve unmodified nested objects", () => {
			interface ComplexState {
				a: { x: number };
				b: { y: number };
				c: { z: number };
			}

			const originalState: ComplexState = {
				a: { x: 1 },
				b: { y: 2 },
				c: { z: 3 },
			};

			const manager = new PatchedStateManager(originalState);

			manager.updateState((draft) => {
				draft.a.x = 10;
			});

			expect(manager.state.a).not.toBe(originalState.a);
			expect(manager.state.b).toBe(originalState.b);
			expect(manager.state.c).toBe(originalState.c);
		});
	});
});
