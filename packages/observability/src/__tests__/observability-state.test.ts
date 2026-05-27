import { describe, expect, it } from "vitest";
import { type ObservabilityState, ObservabilityStateManager } from "../observability-state.js";

function createStateHarness() {
	const state: ObservabilityState = { transports: {} };
	const updateState = (producer: (draft: ObservabilityState) => void) => {
		producer(state);
	};
	return { getState: () => state, updateState };
}

describe("ObservabilityStateManager", () => {
	describe("constructor", () => {
		it("initializes with empty transports state", () => {
			const { getState, updateState } = createStateHarness();
			new ObservabilityStateManager(updateState);

			expect(getState().transports).toEqual({});
		});
	});

	describe("initTransport", () => {
		it("creates a transport entry with default values", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);

			manager.initTransport("loki");

			expect(getState().transports["loki"]).toEqual({
				status: "ok",
				bufferSize: 0,
				lastPushAt: null,
				lastError: null,
				totalPushed: 0,
				totalDropped: 0,
			});
		});

		it("creates multiple transports independently", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);

			manager.initTransport("loki");
			manager.initTransport("datadog");

			expect(Object.keys(getState().transports)).toHaveLength(2);
			expect(getState().transports["loki"]).toBeDefined();
			expect(getState().transports["datadog"]).toBeDefined();
		});
	});

	describe("recordPushSuccess", () => {
		it("sets status to ok", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushSuccess("loki", 5);

			expect(getState().transports["loki"]!.status).toBe("ok");
		});

		it("sets lastPushAt to a recent Date", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			const before = Date.now();
			manager.recordPushSuccess("loki", 5);
			const after = Date.now();

			const lastPushAt = getState().transports["loki"]!.lastPushAt;
			expect(lastPushAt).toBeInstanceOf(Date);
			expect(lastPushAt!.getTime()).toBeGreaterThanOrEqual(before);
			expect(lastPushAt!.getTime()).toBeLessThanOrEqual(after);
		});

		it("increments totalPushed by the batch size", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushSuccess("loki", 10);
			manager.recordPushSuccess("loki", 5);

			expect(getState().transports["loki"]!.totalPushed).toBe(15);
		});

		it("clears lastError on success", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushError("loki", new Error("connection refused"), 1);
			expect(getState().transports["loki"]!.lastError).not.toBeNull();

			manager.recordPushSuccess("loki", 1);
			expect(getState().transports["loki"]!.lastError).toBeNull();
		});

		it("is a no-op for unknown transport names", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);

			expect(() => manager.recordPushSuccess("unknown", 5)).not.toThrow();
			expect(getState().transports["unknown"]).toBeUndefined();
		});
	});

	describe("recordPushError", () => {
		it("sets status to degraded when bufferSize is greater than 0", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushError("loki", new Error("timeout"), 3);

			expect(getState().transports["loki"]!.status).toBe("degraded");
		});

		it("sets status to failing when bufferSize is 0", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushError("loki", new Error("timeout"), 0);

			expect(getState().transports["loki"]!.status).toBe("failing");
		});

		it("stores the error message in lastError", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushError("loki", new Error("connection refused"), 1);

			expect(getState().transports["loki"]!.lastError).toBe("connection refused");
		});

		it("updates bufferSize", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushError("loki", new Error("err"), 7);

			expect(getState().transports["loki"]!.bufferSize).toBe(7);
		});

		it("is a no-op for unknown transport names", () => {
			const { updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);

			expect(() => manager.recordPushError("unknown", new Error("err"), 1)).not.toThrow();
		});
	});

	describe("recordDropped", () => {
		it("increments totalDropped by the count", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordDropped("loki", 3);
			manager.recordDropped("loki", 2);

			expect(getState().transports["loki"]!.totalDropped).toBe(5);
		});

		it("is a no-op for unknown transport names", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);

			expect(() => manager.recordDropped("unknown", 5)).not.toThrow();
			expect(getState().transports["unknown"]).toBeUndefined();
		});
	});

	describe("updateBufferSize", () => {
		it("updates the bufferSize on the transport", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.updateBufferSize("loki", 10);

			expect(getState().transports["loki"]!.bufferSize).toBe(10);
		});

		it("resets status from degraded to ok when buffer reaches 0", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushError("loki", new Error("err"), 3);
			expect(getState().transports["loki"]!.status).toBe("degraded");

			manager.updateBufferSize("loki", 0);

			expect(getState().transports["loki"]!.status).toBe("ok");
		});

		it("does not change failing status when buffer reaches 0", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushError("loki", new Error("err"), 0);
			expect(getState().transports["loki"]!.status).toBe("failing");

			manager.updateBufferSize("loki", 0);

			expect(getState().transports["loki"]!.status).toBe("failing");
		});

		it("does not reset ok status when buffer is non-zero", () => {
			const { getState, updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);
			manager.initTransport("loki");

			manager.recordPushSuccess("loki", 5);
			manager.updateBufferSize("loki", 3);

			expect(getState().transports["loki"]!.status).toBe("ok");
		});

		it("is a no-op for unknown transport names", () => {
			const { updateState } = createStateHarness();
			const manager = new ObservabilityStateManager(updateState);

			expect(() => manager.updateBufferSize("unknown", 5)).not.toThrow();
		});
	});
});
