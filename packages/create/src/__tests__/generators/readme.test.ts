import { describe, expect, it } from "vitest";
import { generateReadme } from "../../generators/readme.js";
import type { Answers } from "../../types.js";

const baseAnswers: Answers = {
	targetDir: "/tmp/test",
	packageName: "my-installation",
	useContent: false,
	useMonitor: false,
	useScheduler: false,
	contentSources: [],
	contentTransforms: [],
	monitorApps: [],
	addGitignore: false,
};

describe("generateReadme", () => {
	it("titles the README with the package name", () => {
		const result = generateReadme({ ...baseAnswers, packageName: "my-app" });
		expect(result).toContain("# my-app");
	});

	it("includes a getting started section with npm install", () => {
		const result = generateReadme(baseAnswers);
		expect(result).toContain("## Getting started");
		expect(result).toContain("npm install");
	});

	it("includes the content script only when useContent is true", () => {
		const withContent = generateReadme({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
		});
		expect(withContent).toContain("npm run content");

		const withoutContent = generateReadme(baseAnswers);
		expect(withoutContent).not.toContain("npm run content");
	});

	it("includes the start and stop scripts only when useMonitor is true", () => {
		const withMonitor = generateReadme({
			...baseAnswers,
			useMonitor: true,
			monitorApps: [{ name: "my-app", script: "./my-app.exe", cwd: "./builds/" }],
		});
		expect(withMonitor).toContain("npm run start");
		expect(withMonitor).toContain("npm run stop");

		const withoutMonitor = generateReadme(baseAnswers);
		expect(withoutMonitor).not.toContain("npm run start");
		expect(withoutMonitor).not.toContain("npm run stop");
	});

	it("points an app at the client SDK and its reference docs", () => {
		const result = generateReadme(baseAnswers);
		expect(result).toContain("## Connecting an app");
		expect(result).toContain("@bluecadet/launchpad-client");
		expect(result).toContain("https://bluecadet.github.io/launchpad/reference/client");
	});
});
