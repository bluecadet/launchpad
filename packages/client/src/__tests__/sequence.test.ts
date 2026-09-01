import { describe, expect, it } from "vitest";
import { createSequenceTracker } from "../sequence.js";

describe("createSequenceTracker", () => {
	it("treats the first connection as no resync and every later one as a gap", () => {
		const tracker = createSequenceTracker();

		expect(tracker.open()).toBe("connected");
		expect(tracker.open()).toBe("reconnected");
		expect(tracker.open()).toBe("reconnected");
	});

	it("reports a reconnect even when no sequenced frame ever arrived", () => {
		const tracker = createSequenceTracker();
		tracker.open();

		expect(tracker.open()).toBe("reconnected");
	});

	it.each([
		["baselines on whatever the first id is", [12], []],
		["accepts consecutive ids", [12, 13, 14], []],
		["flags a forward jump", [12, 14], [{ expected: 13, received: 14 }]],
		["flags a counter reset after a daemon restart", [12, 1], [{ expected: 13, received: 1 }]],
		["flags a repeated id", [12, 12], [{ expected: 13, received: 12 }]],
		["re-baselines after a gap", [12, 20, 21], [{ expected: 13, received: 20 }]],
	])("%s", (_name, ids, expected) => {
		const tracker = createSequenceTracker();
		tracker.open();

		const gaps = ids
			.map((id) => tracker.check(id))
			.filter((check) => check.gap)
			.map((check) => (check.gap ? { expected: check.expected, received: check.received } : null));

		expect(gaps).toEqual(expected);
	});

	it("ignores an untagged frame for baselining", () => {
		const tracker = createSequenceTracker();
		tracker.open();

		expect(tracker.check(undefined).gap).toBe(false);
		expect(tracker.check(12).gap).toBe(false);
		expect(tracker.check(undefined).gap).toBe(false);
		expect(tracker.check(13).gap).toBe(false);
	});

	it("never lets a seq of 0 seed or satisfy a baseline", () => {
		const tracker = createSequenceTracker();
		tracker.open();

		expect(tracker.check(0).gap).toBe(false);
		expect(tracker.check(12).gap).toBe(false);
		expect(tracker.check(0).gap).toBe(false);
		expect(tracker.check(13).gap).toBe(false);
	});

	it("forgets the baseline on reconnect, so the next frame cannot be a gap", () => {
		const tracker = createSequenceTracker();
		tracker.open();
		tracker.check(12);

		tracker.open();

		expect(tracker.check(400).gap).toBe(false);
		expect(tracker.check(402).gap).toBe(true);
	});
});
