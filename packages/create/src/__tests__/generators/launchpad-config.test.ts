import { describe, expect, it } from "vitest";
import { generateLaunchpadConfig } from "../../generators/launchpad-config.js";
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

describe("generateLaunchpadConfig", () => {
	it("does not link to the live content refresh recipe when scheduler and content are unused", () => {
		const result = generateLaunchpadConfig(baseAnswers);
		const recipeLink = "https://bluecadet.github.io/launchpad/recipes/live-content-refresh";

		expect(result).not.toContain(recipeLink);
	});

	it("always imports defineConfig", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useMonitor: true,
			monitorApps: [{ name: "app", script: "./app.exe", cwd: "./" }],
		});
		expect(result).toContain("from '@bluecadet/launchpad/cli'");
		expect(result).toContain("defineConfig");
	});

	it("generates monitor-only config with one app", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useMonitor: true,
			monitorApps: [{ name: "my-app", script: "./my-app.exe", cwd: "./builds/" }],
		});
		expect(result).toContain("from '@bluecadet/launchpad/monitor'");
		expect(result).toContain("monitor(");
		expect(result).toContain("name: 'my-app'");
		expect(result).toContain("script: './my-app.exe'");
		expect(result).toContain("start: ['monitor.connect', 'monitor.start']");
		expect(result).toContain("stop: ['monitor.stop', 'monitor.disconnect']");
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
		expect(result).toContain("from '@bluecadet/launchpad/content'");
		expect(result).toContain("from '@bluecadet/launchpad/content/sources'");
		expect(result).toContain("jsonSource(");
		expect(result).toContain("start: ['content.fetch']");
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
		expect(result).toContain("start: ['content.fetch', 'monitor.connect', 'monitor.start']");
		expect(result).toContain("stop: ['monitor.stop', 'monitor.disconnect']");
	});

	it("generates scheduler config with a guide-link comment", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useScheduler: true,
		});
		const recipeLink = "https://bluecadet.github.io/launchpad/recipes/live-content-refresh";

		expect(result).toContain("from '@bluecadet/launchpad/scheduler'");
		expect(result).toContain("scheduler(");
		expect(result).toContain("'content.fetch': '15m'");
		expect(result).toContain("refetchChecker");
		expect(result).toContain("'refetch.check'");
		expect(result).toContain(`// See ${recipeLink}`);
		expect(result).not.toContain("content(");
		expect(result.split(recipeLink)).toHaveLength(2);
	});

	it("omits the scheduler plugin and import when not selected", () => {
		const result = generateLaunchpadConfig(baseAnswers);
		expect(result).not.toContain("from '@bluecadet/launchpad/scheduler'");
		expect(result).not.toContain("scheduler(");
	});

	it("includes a commented-out versioning hint with the guide link when content is selected alone", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
		});
		const recipeLink = "https://bluecadet.github.io/launchpad/recipes/live-content-refresh";

		expect(result).toContain("// versioning: true,");
		expect(result).toContain(recipeLink);
		// Content-only: the versioning hint is the only place the guide is linked,
		// since it's the path to adding the (unscaffolded) scheduler.
		expect(result.split(recipeLink)).toHaveLength(2);
	});

	it("generates config with content, monitor, and scheduler together", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
			useMonitor: true,
			monitorApps: [{ name: "app", script: "./app.exe", cwd: "./" }],
			useScheduler: true,
		});
		const recipeLink = "https://bluecadet.github.io/launchpad/recipes/live-content-refresh";

		expect(result).toContain("content(");
		expect(result).toContain("monitor(");
		expect(result).toContain("scheduler(");
		// The versioning hint stays, but without the link since the scheduler entry carries it.
		expect(result).toContain("// versioning: true,");
		// The guide link should appear exactly once, on the scheduler entry, not duplicated elsewhere.
		expect(result.split(recipeLink)).toHaveLength(2);
		expect(result).toContain(`// See ${recipeLink}`);
	});

	it("includes all selected sources in a single barrel import", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json", "sanity", "contentful"],
		});
		// All sources in one import from the barrel
		expect(result).toContain("from '@bluecadet/launchpad/content/sources'");
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
		expect(result).toContain("from '@bluecadet/launchpad/content/transforms'");
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
		expect(result).not.toContain("from '@bluecadet/launchpad/content/transforms'");
	});

	it("produces a string containing a valid export default", () => {
		const result = generateLaunchpadConfig({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
		});
		expect(result).toContain("export default defineConfig(");
	});

	describe("http transport hint", () => {
		function generateWithContent() {
			return generateLaunchpadConfig({
				...baseAnswers,
				useContent: true,
				contentSources: ["json"],
			});
		}

		/** Every line the hint contributes, so nothing can slip in uncommented. */
		function hintLines(result: string) {
			const start = result.indexOf("// Push refresh events");
			const end = result.indexOf("// })", start);
			return result.slice(start, end + "// })".length).split("\n");
		}

		it("hints at the http transport with a matching commented import", () => {
			const result = generateWithContent();

			expect(result).toContain(
				"// import { httpTransport } from '@bluecadet/launchpad/controller/transports/http';",
			);
			expect(result).toContain("// httpTransport({");
		});

		it("shows tokens, roles and a matching allowedCommands", () => {
			const result = generateWithContent();

			expect(result).toContain("auth: {");
			expect(result).toContain("roles: {");
			expect(result).toContain("tokens: {");
			expect(result).toContain(
				"'docent-tablet': { env: 'LAUNCHPAD_TOKEN_DOCENT', role: 'docent' }",
			);
			// A role only narrows allowedCommands, so the example is inert without it.
			expect(result).toContain("allowedCommands:");
		});

		it("points an app at the client SDK", () => {
			const result = generateWithContent();

			expect(result).toContain("@bluecadet/launchpad-client");
			expect(result).toContain("/reference/client");
		});

		it("references an environment variable instead of a token value", () => {
			const result = generateWithContent();

			expect(result).toContain("LAUNCHPAD_TOKEN_DOCENT");
			expect(result).not.toMatch(/token['"]?\s*:\s*['"][^'"]+['"]/);
		});

		it("leaves every hint line commented out", () => {
			for (const line of hintLines(generateWithContent())) {
				expect(line.trimStart()).toMatch(/^\/\//);
			}
		});

		it("omits the hint when content is not selected", () => {
			const result = generateLaunchpadConfig(baseAnswers);

			expect(result).not.toContain(
				"// import { httpTransport } from '@bluecadet/launchpad/controller/transports/http';",
			);
			expect(result).not.toContain("// httpTransport({");
		});
	});

	describe("node hint", () => {
		const docsLink = "/reference/controller/controller-config#node";

		it("appears with no answers set, since every project is a potential Node", () => {
			const result = generateLaunchpadConfig(baseAnswers);

			expect(result).toContain("controller:");
			expect(result).toContain("node:");
			expect(result).toContain("id:");
			expect(result).toContain("label:");
			expect(result).toContain("role:");
			expect(result).toContain(docsLink);
		});

		it("leaves every hint line commented out", () => {
			const result = generateLaunchpadConfig(baseAnswers);
			const start = result.indexOf("// Set this once you deploy alongside another Node");
			const end = result.indexOf("// },", start);
			const hintLines = result.slice(start, end + "// },".length).split("\n");

			expect(hintLines.length).toBeGreaterThan(1);
			for (const line of hintLines) {
				expect(line.trimStart()).toMatch(/^\/\//);
			}
		});
	});

	describe("workflow hint", () => {
		it("points at workflow.run when workflows are emitted", () => {
			const result = generateLaunchpadConfig({
				...baseAnswers,
				useMonitor: true,
				monitorApps: [{ name: "app", script: "./app.exe", cwd: "./" }],
			});

			expect(result).toContain("// Trigger these remotely with the `workflow.run` command");
			expect(result).toContain("// see /reference/controller/workflows");
		});

		it("omits the hint when there are no workflows", () => {
			const result = generateLaunchpadConfig(baseAnswers);

			expect(result).not.toContain("workflow.run");
			expect(result).not.toContain("workflows: {");
		});
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
		expect(result).toContain("from '@bluecadet/launchpad/content/transforms'");
	});
});
