import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCronDelay, createDelayFn, createIntervalDelay } from "../timing.js";

describe("createIntervalDelay", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("ignores `from` and always returns the configured interval when jitter is off", () => {
		const delay = createIntervalDelay(300_000, false);
		expect(delay(new Date("2026-01-01T00:00:00Z"))).toBe(300_000);
		expect(delay(new Date("2030-06-15T12:00:00Z"))).toBe(300_000);
	});

	it("adds a jitter contribution bounded by the resolved jitter amount", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const delay = createIntervalDelay(300_000, true);
		// true => 10% of 300_000 = 30_000; at random()=0.5 => +15_000
		expect(delay(new Date())).toBe(315_000);
	});
});

describe("createCronDelay", () => {
	beforeEach(() => {
		// Cron wall-clock semantics are intentionally local-timezone (kiosk business hours);
		// pin to UTC here so the expected offsets below are portable across CI machines.
		process.env.TZ = "UTC";
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("computes the delay until the next wall-clock occurrence", () => {
		const delay = createCronDelay("0 3 * * *", false);
		const from = new Date("2026-01-01T00:00:00Z");
		expect(delay(from)).toBe(3 * 60 * 60 * 1000);
	});

	it("recomputes from a later reference point (no wall-clock drift)", () => {
		const delay = createCronDelay("0 3 * * *", false);
		const from = new Date("2026-01-01T03:00:00Z");
		// nextRun is exclusive: firing exactly at 3am rolls to the next day's 3am.
		expect(delay(from)).toBe(24 * 60 * 60 * 1000);
	});

	it("adds jitter as a percentage of the computed gap", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const delay = createCronDelay("0 3 * * *", true);
		const from = new Date("2026-01-01T00:00:00Z");
		const base = 3 * 60 * 60 * 1000;
		expect(delay(from)).toBe(base + base * 0.1 * 0.5);
	});
});

describe("createDelayFn", () => {
	it("picks the cron delay when `cron` is set", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

		const delay = createDelayFn({
			cron: "0 3 * * *",
			jitter: false,
			retry: { forever: true, backoff: { initial: 15_000, max: 300_000, factor: 2 } },
			command: { type: "content.sync" },
			runOnStart: false,
			enabled: true,
		});
		expect(delay(new Date("2026-01-01T00:00:00Z"))).toBe(3 * 60 * 60 * 1000);
	});

	it("picks the interval delay when `interval` is set", () => {
		const delay = createDelayFn({
			interval: 60_000,
			jitter: false,
			retry: { forever: true, backoff: { initial: 15_000, max: 300_000, factor: 2 } },
			command: { type: "content.fetch" },
			runOnStart: false,
			enabled: true,
		});
		expect(delay(new Date())).toBe(60_000);
	});
});
