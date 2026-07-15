import { describe, expect, it } from "vitest";
import {
	generatePackageJson,
	getRequiredPackages,
	mergePackageJson,
} from "../../generators/package-json.js";
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

function makeDeps(answers: Answers): Record<string, string> {
	return Object.fromEntries(getRequiredPackages(answers).map((pkg) => [pkg, "^1.0.0"]));
}

describe("generatePackageJson", () => {
	it("creates a valid package.json with the given name", () => {
		const answers = { ...baseAnswers, packageName: "my-app" };
		const result = generatePackageJson(answers, makeDeps(answers));
		const pkg = JSON.parse(result) as Record<string, unknown>;
		expect(pkg.name).toBe("my-app");
		expect(pkg.type).toBe("module");
	});

	it("always includes @bluecadet/launchpad", () => {
		const result = generatePackageJson(baseAnswers, makeDeps(baseAnswers));
		const pkg = JSON.parse(result) as { dependencies: Record<string, string> };
		expect(pkg.dependencies["@bluecadet/launchpad"]).toBeDefined();
	});

	it("adds content script when useContent is true", () => {
		const answers = { ...baseAnswers, useContent: true, contentSources: ["json" as const] };
		const result = generatePackageJson(answers, makeDeps(answers));
		const pkg = JSON.parse(result) as { scripts: Record<string, string> };
		expect(pkg.scripts.content).toBe("launchpad content");
	});

	it("adds start and stop scripts when useMonitor is true", () => {
		const answers = { ...baseAnswers, useMonitor: true };
		const result = generatePackageJson(answers, makeDeps(answers));
		const pkg = JSON.parse(result) as { scripts: Record<string, string> };
		expect(pkg.scripts.start).toBe("launchpad start");
		expect(pkg.scripts.stop).toBe("launchpad stop");
	});
});

describe("getRequiredPackages", () => {
	it("always includes @bluecadet/launchpad", () => {
		const packages = getRequiredPackages(baseAnswers);
		expect(packages).toContain("@bluecadet/launchpad");
	});

	it("includes @sanity/client for sanity source", () => {
		const packages = getRequiredPackages({
			...baseAnswers,
			useContent: true,
			contentSources: ["sanity"],
		});
		expect(packages).toContain("@sanity/client");
	});

	it("includes contentful for contentful source", () => {
		const packages = getRequiredPackages({
			...baseAnswers,
			useContent: true,
			contentSources: ["contentful"],
		});
		expect(packages).toContain("contentful");
	});

	it("includes airtable for airtable source", () => {
		const packages = getRequiredPackages({
			...baseAnswers,
			useContent: true,
			contentSources: ["airtable"],
		});
		expect(packages).toContain("airtable");
	});

	it("adds no extra packages for json and strapi sources", () => {
		const packages = getRequiredPackages({
			...baseAnswers,
			useContent: true,
			contentSources: ["json", "strapi"],
		});
		expect(packages).not.toContain("@sanity/client");
		expect(packages).not.toContain("contentful");
	});

	it("includes @portabletext/to-html for sanityToHtml transform", () => {
		const packages = getRequiredPackages({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
			contentTransforms: ["sanityToHtml"],
		});
		expect(packages).toContain("@portabletext/to-html");
	});

	it("includes sharp for sharp transform", () => {
		const packages = getRequiredPackages({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
			contentTransforms: ["sharp"],
		});
		expect(packages).toContain("sharp");
	});

	it("includes @sanity/image-url for sanityImageUrlTransform", () => {
		const packages = getRequiredPackages({
			...baseAnswers,
			useContent: true,
			contentSources: ["json"],
			contentTransforms: ["sanityImageUrlTransform"],
		});
		expect(packages).toContain("@sanity/image-url");
	});

	it("includes @bluecadet/launchpad-scheduler when useScheduler is true", () => {
		const packages = getRequiredPackages({ ...baseAnswers, useScheduler: true });
		expect(packages).toContain("@bluecadet/launchpad-scheduler");
	});

	it("omits @bluecadet/launchpad-scheduler when useScheduler is false", () => {
		const packages = getRequiredPackages(baseAnswers);
		expect(packages).not.toContain("@bluecadet/launchpad-scheduler");
	});
});

describe("mergePackageJson", () => {
	it("preserves existing name and other fields", () => {
		const existing = JSON.stringify({ name: "existing-app", version: "1.2.3", type: "module" });
		const result = mergePackageJson(existing, baseAnswers, makeDeps(baseAnswers));
		const pkg = JSON.parse(result) as Record<string, unknown>;
		expect(pkg.name).toBe("existing-app");
		expect(pkg.version).toBe("1.2.3");
	});

	it("adds new dependencies without overwriting existing ones", () => {
		const existing = JSON.stringify({
			name: "my-app",
			dependencies: { "@bluecadet/launchpad": "1.0.0", "some-other-dep": "^1.0.0" },
		});
		const result = mergePackageJson(existing, baseAnswers, makeDeps(baseAnswers));
		const pkg = JSON.parse(result) as { dependencies: Record<string, string> };
		expect(pkg.dependencies["@bluecadet/launchpad"]).toBe("1.0.0");
		expect(pkg.dependencies["some-other-dep"]).toBe("^1.0.0");
	});

	it("does not overwrite existing scripts", () => {
		const existing = JSON.stringify({
			name: "my-app",
			scripts: { start: "node server.js", content: "my-custom-content-script" },
		});
		const answers = {
			...baseAnswers,
			useContent: true,
			contentSources: ["json" as const],
			useMonitor: true,
		};
		const result = mergePackageJson(existing, answers, makeDeps(answers));
		const pkg = JSON.parse(result) as { scripts: Record<string, string> };
		expect(pkg.scripts.start).toBe("node server.js");
		expect(pkg.scripts.content).toBe("my-custom-content-script");
	});

	it("adds new scripts when they do not exist", () => {
		const existing = JSON.stringify({ name: "my-app", scripts: { build: "tsc" } });
		const answers = { ...baseAnswers, useContent: true, contentSources: ["json" as const] };
		const result = mergePackageJson(existing, answers, makeDeps(answers));
		const pkg = JSON.parse(result) as { scripts: Record<string, string> };
		expect(pkg.scripts.content).toBe("launchpad content");
		expect(pkg.scripts.build).toBe("tsc");
	});
});
