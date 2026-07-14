import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduler } from "../launchpad-scheduler.js";

describe("scheduler plugin", () => {
	it("validates an empty config and sets up cleanly", async () => {
		const plugin = scheduler({});
		const result = await plugin.setup(createMockPluginCtx());

		expect(result).toBeOk();
	});

	it("validates a minimal valid config", async () => {
		const plugin = scheduler({ "content.fetch": "5m" });
		const result = await plugin.setup(createMockPluginCtx());

		expect(result).toBeOk();
	});

	it("rejects an invalid config", async () => {
		const plugin = scheduler({ "content.fetch": { interval: "5m", cron: "0 3 * * *" } });
		const result = await plugin.setup(createMockPluginCtx());

		expect(result).toBeErr();
	});

	describe("scheduling behavior", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("dispatches zero commands when no jobs are configured", async () => {
			const ctx = createMockPluginCtx();
			const plugin = scheduler({});
			await plugin.setup(ctx);

			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

			expect(ctx.dispatchCommand).not.toHaveBeenCalled();
		});

		it("dispatches the configured command once its interval elapses", async () => {
			const ctx = createMockPluginCtx();
			const plugin = scheduler({ "content.fetch": { interval: "5m", jitter: false } });
			await plugin.setup(ctx);

			await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

			expect(ctx.dispatchCommand).toHaveBeenCalledExactlyOnceWith({ type: "content.fetch" });
		});

		it("cancels all timers on disconnect", async () => {
			const ctx = createMockPluginCtx();
			const plugin = scheduler({ "content.fetch": { interval: "5m", jitter: false } });
			const result = await plugin.setup(ctx);
			if (result.isErr() || !result.value.disconnect) {
				throw new Error("Expected setup to return a disconnectable plugin instance");
			}

			await result.value.disconnect({ type: "manual" });
			await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

			expect(ctx.dispatchCommand).not.toHaveBeenCalled();
		});
	});
});
