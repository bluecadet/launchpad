import { describe, expect, it } from "vitest";
import {
	formatClockTime,
	formatDurationMs,
	formatTimeAgo,
	formatTimeUntil,
} from "../status-format.js";

describe("formatDurationMs", () => {
	it.each([
		[3_600_000, "1h"],
		[7_200_000, "2h"],
		[60_000, "1m"],
		[300_000, "5m"],
		[1_000, "1s"],
		[30_000, "30s"],
		[1500, "1500ms"],
		[0, "0s"],
	])("formats %i ms as %s", (input, expected) => {
		expect(formatDurationMs(input)).toBe(expected);
	});

	it("formats zero milliseconds as seconds, not hours", () => {
		expect(formatDurationMs(0)).toBe("0s");
	});
});

describe("formatTimeAgo", () => {
	const now = new Date("2024-01-01T12:00:00Z");

	it("formats an exact hour boundary", () => {
		const date = new Date(now.getTime() - 3_600_000);
		expect(formatTimeAgo(date, now)).toBe("1h ago");
	});

	it("formats 59m59s as minutes, not hours", () => {
		const date = new Date(now.getTime() - (3_600_000 - 1_000));
		expect(formatTimeAgo(date, now)).toBe("59m ago");
	});

	it("formats an exact minute boundary", () => {
		const date = new Date(now.getTime() - 60_000);
		expect(formatTimeAgo(date, now)).toBe("1m ago");
	});

	it("formats 59s as seconds, not minutes", () => {
		const date = new Date(now.getTime() - 59_000);
		expect(formatTimeAgo(date, now)).toBe("59s ago");
	});

	it("formats zero elapsed time", () => {
		expect(formatTimeAgo(now, now)).toBe("0s ago");
	});

	it("clamps a date in the future (negative elapsed) to 0", () => {
		const future = new Date(now.getTime() + 10_000);
		expect(formatTimeAgo(future, now)).toBe("0s ago");
	});

	it("floors partial seconds", () => {
		const date = new Date(now.getTime() - 1_999);
		expect(formatTimeAgo(date, now)).toBe("1s ago");
	});
});

describe("formatTimeUntil", () => {
	const now = new Date("2024-01-01T12:00:00Z");

	it("formats an exact hour boundary", () => {
		const date = new Date(now.getTime() + 3_600_000);
		expect(formatTimeUntil(date, now)).toBe("in 1h");
	});

	it("formats 59m59s as minutes, not hours", () => {
		const date = new Date(now.getTime() + (3_600_000 - 1_000));
		expect(formatTimeUntil(date, now)).toBe("in 59m");
	});

	it("formats an exact minute boundary", () => {
		const date = new Date(now.getTime() + 60_000);
		expect(formatTimeUntil(date, now)).toBe("in 1m");
	});

	it("formats non-round gaps coarsely instead of exact ms/s", () => {
		const date = new Date(now.getTime() + 303_000);
		expect(formatTimeUntil(date, now)).toBe("in 5m");
	});

	it("formats zero remaining time", () => {
		expect(formatTimeUntil(now, now)).toBe("in 0s");
	});

	it("clamps a date in the past (negative remaining) to 0", () => {
		const past = new Date(now.getTime() - 10_000);
		expect(formatTimeUntil(past, now)).toBe("in 0s");
	});
});

describe("formatClockTime", () => {
	it("zero-pads single-digit hours and minutes", () => {
		expect(formatClockTime(new Date(2024, 0, 1, 9, 5))).toBe("09:05");
	});

	it("formats midnight", () => {
		expect(formatClockTime(new Date(2024, 0, 1, 0, 0))).toBe("00:00");
	});

	it("formats double-digit hours and minutes without padding", () => {
		expect(formatClockTime(new Date(2024, 0, 1, 23, 59))).toBe("23:59");
	});
});
