import { CommandInProgressError } from "@bluecadet/launchpad-utils/command-guard";
import { describe, expect, it } from "vitest";
import { isOverlapSkipError } from "../overlap.js";

describe("isOverlapSkipError", () => {
	it("detects an unwrapped CommandInProgressError", () => {
		expect(isOverlapSkipError(new CommandInProgressError())).toBe(true);
	});

	it("detects a CommandInProgressError wrapped as `cause` (the dispatcher's shape)", () => {
		const wrapped = new Error("Plugin command execution failed", {
			cause: new CommandInProgressError(),
		});
		expect(isOverlapSkipError(wrapped)).toBe(true);
	});

	it("returns false for an unrelated error", () => {
		expect(isOverlapSkipError(new Error("boom"))).toBe(false);
	});

	it("returns false for an error wrapping an unrelated cause", () => {
		expect(isOverlapSkipError(new Error("boom", { cause: new Error("nested") }))).toBe(false);
	});
});
