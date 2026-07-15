import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduler } from "../launchpad-scheduler.js";
import { schedulerPauseCommandSchema } from "../scheduler-commands.js";
import type { SchedulerConfig } from "../scheduler-config.js";

describe("jobIdSchema (via schedulerPauseCommandSchema)", () => {
	it("accepts a dotted command id", () => {
		const result = schedulerPauseCommandSchema.safeParse({
			type: "scheduler.pause",
			job: "content.fetch",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a job id with no dot", () => {
		const result = schedulerPauseCommandSchema.safeParse({
			type: "scheduler.pause",
			job: "contentfetch",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a non-string job value", () => {
		const result = schedulerPauseCommandSchema.safeParse({
			type: "scheduler.pause",
			job: 123,
		});
		expect(result.success).toBe(false);
	});
});

/**
 * Exercises the scheduler's runtime commands through the plugin's own `executeCommand`
 * with a mock plugin context: dispatched commands land on `ctx.dispatchCommand`, so the
 * assertions observe scheduling behavior without standing up a real controller.
 */
describe("scheduler runtime commands (via the plugin instance)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function setupScheduler(config: SchedulerConfig) {
		const ctx = createMockPluginCtx();
		const result = await scheduler(config).setup(ctx);
		const instance = result._unsafeUnwrap();
		if (!instance.executeCommand) {
			throw new Error("Expected the scheduler instance to expose executeCommand");
		}
		return { ctx, executeCommand: instance.executeCommand.bind(instance) };
	}

	it("dispatches scheduler.pause and scheduler.resume scoped to a specific job", async () => {
		const { ctx, executeCommand } = await setupScheduler({
			"content.fetch": { interval: "60s", jitter: false },
		});

		const pauseResult = await executeCommand({ type: "scheduler.pause", job: "content.fetch" });
		expect(pauseResult).toBeOk();

		await vi.advanceTimersByTimeAsync(60_000);
		expect(ctx.dispatchCommand).not.toHaveBeenCalledWith({ type: "content.fetch" });

		const resumeResult = await executeCommand({ type: "scheduler.resume", job: "content.fetch" });
		expect(resumeResult).toBeOk();

		await vi.advanceTimersByTimeAsync(60_000);
		expect(ctx.dispatchCommand).toHaveBeenCalledWith({ type: "content.fetch" });
	});

	it("dispatches scheduler.trigger, firing the job immediately and reporting success", async () => {
		const { ctx, executeCommand } = await setupScheduler({
			"content.fetch": { interval: "5m", jitter: false },
		});

		const result = await executeCommand({ type: "scheduler.trigger", job: "content.fetch" });

		expect(result).toBeOk();
		expect(ctx.dispatchCommand).toHaveBeenCalledWith({ type: "content.fetch" });
	});

	it("errors cleanly for an unknown job name", async () => {
		const { executeCommand } = await setupScheduler({ "content.fetch": "5m" });

		const pauseResult = await executeCommand({ type: "scheduler.pause", job: "content.unknown" });
		const resumeResult = await executeCommand({ type: "scheduler.resume", job: "content.unknown" });
		const triggerResult = await executeCommand({
			type: "scheduler.trigger",
			job: "content.unknown",
		});

		expect(pauseResult).toBeErr();
		expect(resumeResult).toBeErr();
		expect(triggerResult).toBeErr();
	});
});
