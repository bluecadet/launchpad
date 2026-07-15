import { afterEach, describe, expect, it, vi } from "vitest";
import { randomJitterMs, resolveCronJitterMs, resolveJitterMs } from "../jitter.js";

describe("resolveJitterMs", () => {
	it("resolves false to zero", () => {
		expect(resolveJitterMs(false, 300_000)).toBe(0);
	});

	it("resolves true to 10% of the base", () => {
		expect(resolveJitterMs(true, 300_000)).toBe(30_000);
	});

	it("resolves an explicit duration to itself, independent of the base", () => {
		expect(resolveJitterMs(45_000, 300_000)).toBe(45_000);
	});
});

describe("resolveCronJitterMs", () => {
	it("resolves false to zero", () => {
		expect(resolveCronJitterMs(false)).toBe(0);
	});

	it("resolves true to a fixed 60s cap, not a percentage of any gap", () => {
		expect(resolveCronJitterMs(true)).toBe(60_000);
	});

	it("resolves an explicit duration to itself", () => {
		expect(resolveCronJitterMs(45_000)).toBe(45_000);
	});
});

describe("randomJitterMs", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns zero for a non-positive max", () => {
		expect(randomJitterMs(0)).toBe(0);
		expect(randomJitterMs(-10)).toBe(0);
	});

	it("stays within [0, max)", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9999);
		expect(randomJitterMs(1000)).toBeCloseTo(999.9, 0);

		vi.spyOn(Math, "random").mockReturnValue(0);
		expect(randomJitterMs(1000)).toBe(0);
	});

	it("rerolls a fresh value on every call", () => {
		const values = [0.1, 0.5, 0.9];
		const randomSpy = vi.spyOn(Math, "random");
		for (const value of values) randomSpy.mockReturnValueOnce(value);

		const results = values.map(() => randomJitterMs(1000));

		expect(results).toEqual(values.map((v) => v * 1000));
	});
});
