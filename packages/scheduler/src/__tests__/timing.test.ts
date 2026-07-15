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

	it("caps default (true) jitter at 60s so a long wall-clock gap never fires hours late", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const delay = createCronDelay("0 3 * * *", true);
		// A ~24h gap: firing just after 3am rolls to the next day's 3am.
		const from = new Date("2026-01-01T03:00:01Z");
		const base = 24 * 60 * 60 * 1000 - 1000;
		// true caps at 60s; at random()=0.5 that's +30s, not ~2.4h (10% of the gap).
		expect(delay(from)).toBe(base + 30_000);
	});

	it("bounds default (true) jitter within 60s even at the worst random draw", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9999);
		const delay = createCronDelay("0 3 * * *", true);
		const from = new Date("2026-01-01T00:00:00Z");
		const base = 3 * 60 * 60 * 1000;
		expect(delay(from)).toBeGreaterThanOrEqual(base);
		expect(delay(from)).toBeLessThan(base + 60_000);
	});

	it("honors an explicit jitter duration on a cron schedule", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const delay = createCronDelay("0 3 * * *", 45_000);
		const from = new Date("2026-01-01T00:00:00Z");
		const base = 3 * 60 * 60 * 1000;
		// Explicit durations are unaffected by the cron cap: 45s max, +22.5s at random()=0.5.
		expect(delay(from)).toBe(base + 22_500);
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
