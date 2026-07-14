import { describe, expect, it } from "vitest";
import { DurationParseError, durationSchema, parseDuration } from "../duration.js";

describe("parseDuration", () => {
	it("parses milliseconds", () => {
		expect(parseDuration("500ms")).toBe(500);
	});

	it("parses seconds", () => {
		expect(parseDuration("30s")).toBe(30_000);
	});

	it("parses minutes", () => {
		expect(parseDuration("5m")).toBe(300_000);
	});

	it("parses hours", () => {
		expect(parseDuration("2h")).toBe(7_200_000);
	});

	it("parses fractional amounts", () => {
		expect(parseDuration("1.5h")).toBe(5_400_000);
	});

	it("passes raw millisecond numbers through", () => {
		expect(parseDuration(1234)).toBe(1234);
	});

	it("throws on a negative number", () => {
		expect(() => parseDuration(-1)).toThrow(DurationParseError);
	});

	it("throws on a non-finite number", () => {
		expect(() => parseDuration(Number.POSITIVE_INFINITY)).toThrow(DurationParseError);
	});

	it("throws on an unrecognized unit", () => {
		expect(() => parseDuration("5d")).toThrow(DurationParseError);
	});

	it("throws on a malformed string", () => {
		expect(() => parseDuration("five minutes")).toThrow(DurationParseError);
	});
});

describe("durationSchema", () => {
	it("resolves a duration string to milliseconds", () => {
		expect(durationSchema.parse("30m")).toBe(1_800_000);
	});

	it("resolves a raw number to itself", () => {
		expect(durationSchema.parse(5000)).toBe(5000);
	});

	it("rejects an invalid duration string", () => {
		expect(() => durationSchema.parse("not-a-duration")).toThrow();
	});
});
