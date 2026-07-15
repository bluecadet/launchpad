import { describe, expect, it } from "vitest";
import { resolveSchedulerConfig, schedulerConfigSchema } from "../scheduler-config.js";

describe("schedulerConfigSchema", () => {
	it("is valid and inert for an empty config", () => {
		expect(resolveSchedulerConfig({})).toEqual({});
	});

	describe("bare string auto-detection", () => {
		it("detects a duration string as an interval job", () => {
			const config = resolveSchedulerConfig({ "content.fetch": "5m" });

			expect(config["content.fetch"]).toMatchObject({
				interval: 300_000,
				command: { type: "content.fetch" },
			});
			expect(config["content.fetch"]).not.toHaveProperty("cron");
		});

		it("detects a 5-field cron expression as a cron job", () => {
			const config = resolveSchedulerConfig({ "content.sync": "*/5 9-18 * * *" });

			expect(config["content.sync"]).toMatchObject({
				cron: "*/5 9-18 * * *",
				command: { type: "content.sync" },
			});
			expect(config["content.sync"]).not.toHaveProperty("interval");
		});

		it("rejects a bare string that is neither a duration nor a 5-field cron expression", () => {
			expect(() => schedulerConfigSchema.parse({ "content.fetch": "not-a-duration" })).toThrow();
		});
	});

	describe("defaults", () => {
		it("applies all defaults for a minimal interval job", () => {
			const config = resolveSchedulerConfig({ "content.fetch": { interval: "5m" } });

			expect(config["content.fetch"]).toEqual({
				interval: 300_000,
				jitter: true,
				retry: {
					forever: true,
					backoff: { initial: 15_000, max: 300_000, factor: 2 },
				},
				command: { type: "content.fetch" },
				runOnStart: false,
				enabled: true,
			});
		});

		it("defaults command to { type: <key> } when omitted", () => {
			const config = resolveSchedulerConfig({ "content.fetch": "5m" });

			expect(config["content.fetch"]?.command).toEqual({ type: "content.fetch" });
		});

		it("preserves an explicit command override", () => {
			const config = resolveSchedulerConfig({
				"content.fetch": { interval: "5m", command: { type: "content.fetch", sources: ["a"] } },
			});

			expect(config["content.fetch"]?.command).toEqual({ type: "content.fetch", sources: ["a"] });
		});
	});

	describe("interval/cron XOR", () => {
		it("rejects specifying both interval and cron", () => {
			expect(() =>
				schedulerConfigSchema.parse({
					"content.fetch": { interval: "5m", cron: "0 3 * * *" },
				}),
			).toThrow();
		});

		it("rejects specifying neither interval nor cron", () => {
			expect(() => schedulerConfigSchema.parse({ "content.fetch": { enabled: true } })).toThrow();
		});
	});

	describe("jitter", () => {
		it("accepts a duration override", () => {
			const config = resolveSchedulerConfig({ "content.fetch": { interval: "5m", jitter: "45s" } });

			expect(config["content.fetch"]?.jitter).toBe(45_000);
		});

		it("accepts false to disable jitter", () => {
			const config = resolveSchedulerConfig({ "content.fetch": { interval: "5m", jitter: false } });

			expect(config["content.fetch"]?.jitter).toBe(false);
		});
	});

	describe("retry", () => {
		it("accepts the opt-out maxAttempts shape", () => {
			const config = resolveSchedulerConfig({
				"content.fetch": { interval: "5m", retry: { forever: false, maxAttempts: 3 } },
			});

			expect(config["content.fetch"]?.retry).toEqual({ forever: false, maxAttempts: 3 });
		});

		it("allows overriding individual backoff fields", () => {
			const config = resolveSchedulerConfig({
				"content.fetch": { interval: "5m", retry: { backoff: { initial: "10s", max: "2m" } } },
			});

			expect(config["content.fetch"]?.retry).toEqual({
				forever: true,
				backoff: { initial: 10_000, max: 120_000, factor: 2 },
			});
		});
	});

	it("supports raw ms numbers for interval", () => {
		const config = resolveSchedulerConfig({ "content.fetch": { interval: 5000 } });

		expect(config["content.fetch"]?.interval).toBe(5000);
	});

	it("rejects an unparseable duration in the interval field", () => {
		expect(() =>
			schedulerConfigSchema.parse({ "content.fetch": { interval: "not-a-duration" } }),
		).toThrow();
	});
});
