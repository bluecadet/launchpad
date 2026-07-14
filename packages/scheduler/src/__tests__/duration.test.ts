import { describe, expect, it } from "vitest";
import { parseDuration } from "../duration.js";

describe("parseDuration", () => {
	it.each([
		["500ms", 500],
		["30s", 30_000],
		["5m", 300_000],
		["2h", 7_200_000],
		["1.5s", 1500],
		["0ms", 0],
	])("parses %s as %i ms", (input, expected) => {
		expect(parseDuration(input)).toBe(expected);
	});

	it("accepts raw ms numbers", () => {
		expect(parseDuration(1234)).toBe(1234);
	});

	it("accepts zero", () => {
		expect(parseDuration(0)).toBe(0);
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
