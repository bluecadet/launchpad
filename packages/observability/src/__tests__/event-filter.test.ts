import { describe, expect, it } from "vitest";
import { shouldIncludeEvent } from "../core/event-filter.js";

describe("shouldIncludeEvent", () => {
	describe("empty include list", () => {
		it("passes all events through when include is empty", () => {
			expect(shouldIncludeEvent("log:info", [], [])).toBe(true);
			expect(shouldIncludeEvent("monitor:app:crash", [], [])).toBe(true);
			expect(shouldIncludeEvent("anything:at:all", [], [])).toBe(true);
		});
	});

	describe("non-empty include list", () => {
		it("includes only events matching a pattern", () => {
			expect(shouldIncludeEvent("log:info", ["log:*"], [])).toBe(true);
			expect(shouldIncludeEvent("log:error", ["log:*"], [])).toBe(true);
		});

		it("excludes events that do not match any include pattern", () => {
			expect(shouldIncludeEvent("monitor:app:crash", ["log:*"], [])).toBe(false);
			expect(shouldIncludeEvent("system:startup", ["log:*"], [])).toBe(false);
		});

		it("matches any of multiple include patterns", () => {
			const include = ["log:*", "monitor:*"];
			expect(shouldIncludeEvent("log:info", include, [])).toBe(true);
			expect(shouldIncludeEvent("monitor:app:crash", include, [])).toBe(true);
			expect(shouldIncludeEvent("system:startup", include, [])).toBe(false);
		});
	});

	describe("exclude patterns", () => {
		it("excludes matching events even when include is empty", () => {
			expect(shouldIncludeEvent("log:debug", [], ["log:debug"])).toBe(false);
		});

		it("excludes matching events when they also match include", () => {
			expect(shouldIncludeEvent("log:debug", ["log:*"], ["log:debug"])).toBe(false);
		});

		it("does not exclude non-matching events", () => {
			expect(shouldIncludeEvent("log:info", ["log:*"], ["log:debug"])).toBe(true);
		});

		it("exclude takes precedence over include for wildcard overlap", () => {
			expect(shouldIncludeEvent("log:verbose", ["log:*"], ["log:verbose"])).toBe(false);
			expect(shouldIncludeEvent("log:info", ["log:*"], ["log:verbose"])).toBe(true);
		});
	});

	describe("wildcard matching", () => {
		it("matches log:* against log:info but not monitor:app:crash", () => {
			expect(shouldIncludeEvent("log:info", ["log:*"], [])).toBe(true);
			expect(shouldIncludeEvent("monitor:app:crash", ["log:*"], [])).toBe(false);
		});

		it("matches log:* against all log sub-events", () => {
			const include = ["log:*"];
			expect(shouldIncludeEvent("log:error", include, [])).toBe(true);
			expect(shouldIncludeEvent("log:warn", include, [])).toBe(true);
			expect(shouldIncludeEvent("log:info", include, [])).toBe(true);
			expect(shouldIncludeEvent("log:debug", include, [])).toBe(true);
			expect(shouldIncludeEvent("log:verbose", include, [])).toBe(true);
		});

		it("does not match log:* against events that start with a different prefix", () => {
			expect(shouldIncludeEvent("nolog:info", ["log:*"], [])).toBe(false);
		});

		it("matches * alone against any event", () => {
			expect(shouldIncludeEvent("log:info", ["*"], [])).toBe(true);
			expect(shouldIncludeEvent("monitor:app:crash", ["*"], [])).toBe(true);
		});

		it("matches multi-segment wildcards like monitor:*", () => {
			expect(shouldIncludeEvent("monitor:app:crash", ["monitor:*"], [])).toBe(true);
			expect(shouldIncludeEvent("monitor:app:online", ["monitor:*"], [])).toBe(true);
			expect(shouldIncludeEvent("log:info", ["monitor:*"], [])).toBe(false);
		});
	});

	describe("exact matches", () => {
		it("matches exactly when no wildcard is present", () => {
			expect(shouldIncludeEvent("log:info", ["log:info"], [])).toBe(true);
		});

		it("does not match partial names without wildcard", () => {
			expect(shouldIncludeEvent("log:info:extra", ["log:info"], [])).toBe(false);
			expect(shouldIncludeEvent("log:infoX", ["log:info"], [])).toBe(false);
		});

		it("does not match a prefix without wildcard", () => {
			expect(shouldIncludeEvent("log:info", ["log"], [])).toBe(false);
		});
	});

	describe("double wildcards and edge cases", () => {
		it("handles double wildcard pattern", () => {
			expect(shouldIncludeEvent("log:info", ["**"], [])).toBe(true);
			expect(shouldIncludeEvent("a:b:c:d", ["**"], [])).toBe(true);
		});

		it("handles pattern with wildcard in the middle", () => {
			expect(shouldIncludeEvent("log:info", ["log:*:extra"], [])).toBe(false);
			expect(shouldIncludeEvent("log:something:extra", ["log:*:extra"], [])).toBe(true);
		});

		it("handles empty string event name", () => {
			expect(shouldIncludeEvent("", [], [])).toBe(true);
			expect(shouldIncludeEvent("", ["*"], [])).toBe(true);
			expect(shouldIncludeEvent("", ["log:*"], [])).toBe(false);
		});

		it("handles special regex characters in patterns treated as literals", () => {
			expect(shouldIncludeEvent("log.info", ["log.info"], [])).toBe(true);
			expect(shouldIncludeEvent("logXinfo", ["log.info"], [])).toBe(false);
		});
	});
});
