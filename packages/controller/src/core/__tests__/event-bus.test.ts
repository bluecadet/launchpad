import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents {
		[name: string]: any;
	}
}

describe("EventBus", () => {
	describe("emit and on", () => {
		it("should emit events to subscribers", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			bus.on("test:event", handler);
			bus.emit("test:event", { value: 123 });

			expect(handler).toHaveBeenCalledWith({ value: 123 });
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should support multiple subscribers for same event", () => {
			const bus = new EventBus();
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			bus.on("test:event", handler1);
			bus.on("test:event", handler2);
			bus.emit("test:event", { value: 456 });

			expect(handler1).toHaveBeenCalledWith({ value: 456 });
			expect(handler2).toHaveBeenCalledWith({ value: 456 });
		});

		it("should return true when event has listeners", () => {
			const bus = new EventBus();
			bus.on("test:event", () => {});

			const result = bus.emit("test:event", {});
			expect(result).toBe(true);
		});

		it("should return false when event has no listeners", () => {
			const bus = new EventBus();
			const result = bus.emit("test:event", {});
			expect(result).toBe(false);
		});

		it("should type-check known events", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			// Type-safe known event
			bus.on("command:start", handler);
			bus.emit("command:start", { commandType: "test.command" });

			expect(handler).toHaveBeenCalledWith({ commandType: "test.command" });
		});
	});

	describe("off", () => {
		it("should remove event listeners", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			bus.on("test:event", handler);
			bus.off("test:event", handler);
			bus.emit("test:event", {});

			expect(handler).not.toHaveBeenCalled();
		});

		it("should only remove specified handler", () => {
			const bus = new EventBus();
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			bus.on("test:event", handler1);
			bus.on("test:event", handler2);
			bus.off("test:event", handler1);
			bus.emit("test:event", {});

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalled();
		});
	});

	describe("once", () => {
		it("should only trigger handler once", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			bus.once("test:event", handler);
			bus.emit("test:event", { value: 1 });
			bus.emit("test:event", { value: 2 });

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith({ value: 1 });
		});
	});

	describe("onAny", () => {
		it("should receive all events", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			bus.onAny(handler);
			bus.emit("event:one", { value: 1 });
			bus.emit("event:two", { value: 2 });

			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, "event:one", { value: 1 });
			expect(handler).toHaveBeenNthCalledWith(2, "event:two", { value: 2 });
		});

		it("should call wildcard handlers before specific handlers", () => {
			const bus = new EventBus();
			const callOrder: string[] = [];
			const wildcardHandler = vi.fn(() => callOrder.push("wildcard"));
			const specificHandler = vi.fn(() => callOrder.push("specific"));

			bus.onAny(wildcardHandler);
			bus.on("test:event", specificHandler);
			bus.emit("test:event", {});

			expect(callOrder).toEqual(["wildcard", "specific"]);
		});

		it("should catch errors in wildcard handlers without stopping other handlers", () => {
			const bus = new EventBus();
			const errorHandler = vi.fn(() => {
				throw new Error("Wildcard error");
			});
			const goodHandler = vi.fn();
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			bus.onAny(errorHandler);
			bus.onAny(goodHandler);
			bus.emit("test:event", {});

			expect(errorHandler).toHaveBeenCalled();
			expect(goodHandler).toHaveBeenCalled();
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error in wildcard event handler for 'test:event'"),
				expect.any(Error),
			);

			consoleSpy.mockRestore();
		});
	});

	describe("offAny", () => {
		it("should remove wildcard listeners", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			bus.onAny(handler);
			bus.offAny(handler);
			bus.emit("test:event", {});

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("onPattern", () => {
		it("should match events by regex pattern", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			bus.onPattern(/^content:.*$/, handler);
			bus.emit("content:fetch:start", {});
			bus.emit("content:fetch:done", {});
			bus.emit("monitor:connect", {});

			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, "content:fetch:start", {});
			expect(handler).toHaveBeenNthCalledWith(2, "content:fetch:done", {});
		});

		it("should support complex patterns", () => {
			const bus = new EventBus();
			const handler = vi.fn();

			// Match all :error events
			bus.onPattern(/:error$/, handler);
			bus.emit("content:fetch:error", { error: new Error("test") });
			bus.emit("monitor:app:error", { error: new Error("test") });
			bus.emit("content:fetch:done", {});

			expect(handler).toHaveBeenCalledTimes(2);
		});
	});

	describe("removeAllListeners", () => {
		it("should remove all listeners for a specific event", () => {
			const bus = new EventBus();
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			bus.on("test:event", handler1);
			bus.on("test:event", handler2);
			bus.removeAllListeners("test:event");
			bus.emit("test:event", {});

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});

		it("should remove all listeners including wildcard when no event specified", () => {
			const bus = new EventBus();
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const wildcardHandler = vi.fn();

			bus.on("test:event", handler1);
			bus.on("other:event", handler2);
			bus.onAny(wildcardHandler);

			// Verify listeners are registered
			expect(bus.listenerCount("test:event")).toBe(1);
			expect(bus.listenerCount("other:event")).toBe(1);

			bus.removeAllListeners();

			// Verify listeners are removed
			expect(bus.listenerCount("test:event")).toBe(0);
			expect(bus.listenerCount("other:event")).toBe(0);

			bus.emit("test:event", {});
			bus.emit("other:event", {});

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
			expect(wildcardHandler).not.toHaveBeenCalled();
		});
	});

	describe("listenerCount", () => {
		it("should return correct listener count", () => {
			const bus = new EventBus();

			expect(bus.listenerCount("test:event")).toBe(0);

			bus.on("test:event", () => {});
			expect(bus.listenerCount("test:event")).toBe(1);

			bus.on("test:event", () => {});
			expect(bus.listenerCount("test:event")).toBe(2);

			bus.on("other:event", () => {});
			expect(bus.listenerCount("test:event")).toBe(2);
			expect(bus.listenerCount("other:event")).toBe(1);
		});
	});
});
