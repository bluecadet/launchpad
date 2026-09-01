import { describe, expect, it } from "vitest";
import { createPatternMatcher } from "../pattern-matcher.js";

describe("createPatternMatcher", () => {
	it("matches an entry without a wildcard exactly", () => {
		const matches = createPatternMatcher(["session.current"]);

		expect(matches("session.current")).toBe(true);
		expect(matches("session.currently")).toBe(false);
		expect(matches("session")).toBe(false);
	});

	it("prefix-matches an entry ending in a wildcard", () => {
		const matches = createPatternMatcher(["content:*"]);

		expect(matches("content:fetch:start")).toBe(true);
		expect(matches("monitor:app:started")).toBe(false);
	});

	it("matches everything on a lone wildcard", () => {
		const matches = createPatternMatcher(["*"]);

		expect(matches("anything")).toBe(true);
		expect(matches("")).toBe(true);
	});

	it("matches nothing on an empty pattern list", () => {
		const matches = createPatternMatcher([]);

		expect(matches("content.ack")).toBe(false);
	});

	it("treats the dot as an ordinary character, not a separator", () => {
		const matches = createPatternMatcher(["workflow.*"]);

		expect(matches("workflow.run")).toBe(true);
		expect(matches("workflow.list")).toBe(true);
		expect(matches("workflows.run")).toBe(false);
	});

	it("matches when any one entry matches", () => {
		const matches = createPatternMatcher(["workflow.*", "monitor.*"]);

		expect(matches("monitor.restart")).toBe(true);
		expect(matches("content.ack")).toBe(false);
	});
});
