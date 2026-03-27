import { describe, expect, it } from "vitest";
import { generateLaunchpadConfig } from "../../generators/launchpad-config.js";
import type { Answers } from "../../types.js";

const baseAnswers: Answers = {
	targetDir: "/tmp/test",
	packageName: "my-installation",
	useContent: false,
	useMonitor: false,
	contentSources: [],
	contentTransforms: [],
	monitorApps: [],
	addGitignore: false,
};

describe("generateLaunchpadConfig", () => {
	it("always imports defineConfig", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useMonitor: true,
			monitorApps: [{ name: "app", script: "./app.exe", cwd: "./" }],
		});
		expect(result).toContain("from '@bluecadet/launchpad-cli'");
		expect(result).toContain("defineConfig");
	});

	it("generates monitor-only config with one app", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useMonitor: true,
			monitorApps: [{ name: "my-app", script: "./my-app.exe", cwd: "./builds/" }],
		});
		expect(result).toContain("from '@bluecadet/launchpad-monitor/launchpad-monitor'");
		expect(result).toContain("monitor(");
		expect(result).toContain("name: 'my-app'");
		expect(result).toContain("script: './my-app.exe'");
		expect(result).not.toContain("content(");
	});

	it("generates monitor config with multiple apps", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useMonitor: true,
			monitorApps: [
				{ name: "app-one", script: "./one.exe", cwd: "./" },
				{ name: "app-two", script: "./two.exe", cwd: "./" },
			],
		});
		expect(result).toContain("name: 'app-one'");
		expect(result).toContain("name: 'app-two'");
	});

	it("generates monitor config with no apps", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useMonitor: true,
			monitorApps: [],
		});
		expect(result).toContain("monitor(");
		expect(result).toContain("apps: []");
	});

	it("generates content-only config with json source", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
		});
		expect(result).toContain("from '@bluecadet/launchpad-content/launchpad-content'");
		expect(result).toContain("from '@bluecadet/launchpad-content/sources'");
		expect(result).toContain("jsonSource(");
		expect(result).not.toContain("monitor(");
	});

	it("generates config with both plugins", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
			useMonitor: true,
			monitorApps: [{ name: "app", script: "./app.exe", cwd: "./" }],
		});
		expect(result).toContain("content(");
		expect(result).toContain("monitor(");
	});

	it("includes all selected sources in a single barrel import", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json", "sanity", "contentful"],
		});
		// All sources in one import from the barrel
		expect(result).toContain("from '@bluecadet/launchpad-content/sources'");
		expect(result).toContain("jsonSource");
		expect(result).toContain("sanitySource");
		expect(result).toContain("contentfulSource");
		// No individual source paths
		expect(result).not.toContain("/sources/json");
		expect(result).not.toContain("/sources/sanity");
	});

	it("includes transform imports in a single barrel import when transforms are selected", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
			contentTransforms: ["mediaDownloader", "sharp"],
		});
		expect(result).toContain("from '@bluecadet/launchpad-content/transforms'");
		expect(result).toContain("mediaDownloader");
		expect(result).toContain("sharp");
		// No individual transform paths
		expect(result).not.toContain("/transforms/media-downloader");
		expect(result).not.toContain("/transforms/sharp");
		expect(result).toContain("mediaDownloader()");
	});

	it("omits transforms block when no transforms selected", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
			contentTransforms: [],
		});
		expect(result).not.toContain("transforms:");
		expect(result).not.toContain("from '@bluecadet/launchpad-content/transforms'");
	});

	it("produces a string containing a valid export default", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
		});
		expect(result).toContain("export default defineConfig(");
	});

	it("includes sanity-specific transform named exports", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["sanity"],
			contentTransforms: ["sanityToHtml", "sanityToMarkdown", "sanityImageUrlTransform"],
		});
		expect(result).toContain("sanityToHtml");
		expect(result).toContain("sanityToMarkdown");
		expect(result).toContain("sanityImageUrlTransform");
		expect(result).toContain("from '@bluecadet/launchpad-content/transforms'");
	});
});
