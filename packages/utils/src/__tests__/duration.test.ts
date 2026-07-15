import { describe, expect, it } from "vitest";
import { durationSchema, parseDuration } from "../duration.js";

describe("parseDuration", () => {
	it.each([
		["500ms", 500],
		["30s", 30_000],
		["5m", 300_000],
		["2h", 7_200_000],
		["1.5m", 90_000],
		["1.5s", 1500],
		["1.5h", 5_400_000],
		["0ms", 0],
	])("parses %s as %i ms", (input, expected) => {
		expect(parseDuration(input)).toBe(expected);
	});

	it("trims surrounding whitespace", () => {
		expect(parseDuration("  30s  ")).toBe(30_000);
	});

	it("accepts raw ms numbers", () => {
		expect(parseDuration(1234)).toBe(1234);
	});

	it("accepts zero", () => {
		expect(parseDuration(0)).toBe(0);
	});

	it("accepts positive raw ms numbers", () => {
		expect(parseDuration(42)).toBe(42);
	});

	it.each([
		"",
		"5",
		"5x",
		"ms",
		"-5s",
		"5 m",
		"five minutes",
		"5mm",
		"Infinity",
		"5d",
		"m5",
	])("rejects garbage input %j", (input) => {
		expect(parseDuration(input)).toBeNull();
	});

	it("rejects negative raw ms numbers", () => {
		expect(parseDuration(-1)).toBeNull();
	});

	it("rejects non-finite raw ms numbers", () => {
		expect(parseDuration(Number.POSITIVE_INFINITY)).toBeNull();
		expect(parseDuration(Number.NaN)).toBeNull();
	});
});

describe("durationSchema", () => {
	it("resolves a duration string to milliseconds", () => {
		expect(durationSchema.parse("30m")).toBe(1_800_000);
	});

	it("resolves a raw number to itself", () => {
		expect(durationSchema.parse(5000)).toBe(5000);
	});

	it("reports an issue containing 'Invalid duration' for invalid input", () => {
		const result = durationSchema.safeParse("not-a-duration");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain("Invalid duration");
	});

	it("reports an issue for invalid numeric input", () => {
		const result = durationSchema.safeParse(-1);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain("Invalid duration");
	});
});
