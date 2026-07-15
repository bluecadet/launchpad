import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRetryDelayMs } from "../backoff.js";
import type { ResolvedRetry } from "../scheduler-config.js";

const FOREVER_RETRY: ResolvedRetry = {
	forever: true,
	backoff: { initial: 15_000, max: 300_000, factor: 2 },
};

const LIMITED_RETRY: ResolvedRetry = { forever: false, maxAttempts: 5 };

describe("computeRetryDelayMs", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("starts at backoff.initial for the first failure", () => {
		expect(computeRetryDelayMs(1, FOREVER_RETRY, false)).toBe(15_000);
	});

	it("grows geometrically by backoff.factor per consecutive failure", () => {
		expect(computeRetryDelayMs(2, FOREVER_RETRY, false)).toBe(30_000);
		expect(computeRetryDelayMs(3, FOREVER_RETRY, false)).toBe(60_000);
		expect(computeRetryDelayMs(4, FOREVER_RETRY, false)).toBe(120_000);
	});

	it("caps growth at backoff.max", () => {
		expect(computeRetryDelayMs(6, FOREVER_RETRY, false)).toBe(300_000);
		expect(computeRetryDelayMs(10, FOREVER_RETRY, false)).toBe(300_000);
	});

	it("re-rolls jitter as a percentage of the current backoff tier", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		// attempt 2 => base 30_000; jitter true => 10% => 3_000; at random()=0.5 => +1_500
		expect(computeRetryDelayMs(2, FOREVER_RETRY, true)).toBe(31_500);
	});

	it("uses the same default backoff curve for forever:false jobs (no config override exists)", () => {
		expect(computeRetryDelayMs(1, LIMITED_RETRY, false)).toBe(15_000);
		expect(computeRetryDelayMs(3, LIMITED_RETRY, false)).toBe(60_000);
	});
});
