import { describe, expect, it } from "vitest";
import { generateGitignore, mergeGitignore } from "../../generators/gitignore.js";

describe("generateGitignore", () => {
	it("includes all expected entries", () => {
		const result = generateGitignore();
		expect(result).toContain("node_modules/");
		expect(result).toContain("dist/");
		expect(result).toContain(".launchpad/");
		expect(result).toContain(".downloads/");
	});

	it("includes the section marker", () => {
		const result = generateGitignore();
		expect(result).toContain("# Added by create-launchpad");
	});

	it("ends with a newline", () => {
		const result = generateGitignore();
		expect(result.endsWith("\n")).toBe(true);
	});
});

describe("mergeGitignore", () => {
	it("returns unchanged content when all entries already present", () => {
		const existing = "node_modules/\ndist/\n.launchpad/\n.downloads/\n.env.*.local\n.env.local\n";
		const result = mergeGitignore(existing);
		expect(result).toBe(existing);
	});

	it("appends missing entries to existing content", () => {
		const existing = "node_modules/\n";
		const result = mergeGitignore(existing);
		expect(result).toContain("dist/");
		expect(result).toContain(".launchpad/");
		expect(result).toContain(".downloads/");
	});

	it("does not duplicate existing entries", () => {
		const existing = "node_modules/\ndist/\n";
		const result = mergeGitignore(existing);
		const count = result.split("node_modules/").length - 1;
		expect(count).toBe(1);
	});

	it("adds section marker when entries are added", () => {
		const existing = "# My project\n";
		const result = mergeGitignore(existing);
		expect(result).toContain("# Added by create-launchpad");
	});

	it("preserves existing content before the new section", () => {
		const existing = "# My project\nbuild/\n";
		const result = mergeGitignore(existing);
		expect(result.startsWith("# My project\nbuild/\n")).toBe(true);
	});
});
