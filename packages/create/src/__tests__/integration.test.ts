import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { getRequiredPackages } from "../generators/index.js";
import { applyGenerators } from "../main.js";
import type { Answers } from "../types.js";

// node:fs/promises is globally mocked by @bluecadet/launchpad-testing/setup.ts
// Pass pre-resolved deps to applyGenerators to avoid hitting the npm registry in tests.

const baseAnswers: Answers = {
	targetDir: "/project",
	packageName: "my-installation",
	useContent: true,
	useMonitor: true,
	contentSources: ["json"],
	contentTransforms: ["mediaDownloader"],
	monitorApps: [{ name: "my-app", script: "./my-app.exe", cwd: "./builds/" }],
	addGitignore: true,
};

function mockDeps(answers: Answers): Record<string, string> {
	return Object.fromEntries(getRequiredPackages(answers).map((pkg) => [pkg, "^1.0.0"]));
}

afterEach(() => {
	vol.reset();
});

describe("applyGenerators", () => {
	it("creates all four files in a new directory", async () => {
		vol.mkdirSync("/project", { recursive: true });

		const result = await applyGenerators(baseAnswers, mockDeps(baseAnswers));

		expect(result.created).toContain("package.json");
		expect(result.created).toContain("tsconfig.json");
		expect(result.created).toContain("launchpad.config.ts");
		expect(result.created).toContain(".gitignore");
		expect(result.updated).toHaveLength(0);
	});

	it("creates a valid launchpad.config.ts", async () => {
		vol.mkdirSync("/project", { recursive: true });

		await applyGenerators(baseAnswers, mockDeps(baseAnswers));

		const config = vol.readFileSync("/project/launchpad.config.ts", "utf-8") as string;
		expect(config).toContain("defineConfig");
		expect(config).toContain("jsonSource");
		expect(config).toContain("monitor(");
		expect(config).toContain("workflows");
		expect(config).toContain("start: ['content.fetch', 'monitor.connect', 'monitor.start']");
		expect(config).toContain("stop: ['monitor.stop', 'monitor.disconnect']");
	});

	it("merges into existing package.json without overwriting", async () => {
		vol.mkdirSync("/project", { recursive: true });
		vol.writeFileSync(
			"/project/package.json",
			JSON.stringify({ name: "existing-project", version: "2.0.0", scripts: { build: "tsc" } }),
		);

		const result = await applyGenerators(baseAnswers, mockDeps(baseAnswers));

		expect(result.updated).toContain("package.json");
		expect(result.created).not.toContain("package.json");

		const pkg = JSON.parse(vol.readFileSync("/project/package.json", "utf-8") as string) as {
			name: string;
			version: string;
			scripts: Record<string, string>;
		};
		expect(pkg.name).toBe("existing-project");
		expect(pkg.version).toBe("2.0.0");
		expect(pkg.scripts.build).toBe("tsc");
	});

	it("skips existing launchpad.config.ts without overwriting", async () => {
		vol.mkdirSync("/project", { recursive: true });
		vol.writeFileSync("/project/launchpad.config.ts", "// my custom config\n");

		const result = await applyGenerators(baseAnswers, mockDeps(baseAnswers));

		expect(result.skipped.some((s) => s.includes("launchpad.config.ts"))).toBe(true);
		const content = vol.readFileSync("/project/launchpad.config.ts", "utf-8") as string;
		expect(content).toBe("// my custom config\n");
	});

	it("merges existing .gitignore without duplicating entries", async () => {
		vol.mkdirSync("/project", { recursive: true });
		vol.writeFileSync("/project/.gitignore", "node_modules/\n");

		const result = await applyGenerators(baseAnswers, mockDeps(baseAnswers));

		expect(result.updated).toContain(".gitignore");
		const gitignore = vol.readFileSync("/project/.gitignore", "utf-8") as string;
		const count = gitignore.split("node_modules/").length - 1;
		expect(count).toBe(1);
		expect(gitignore).toContain(".downloads/");
	});

	it("skips .gitignore when all entries already present", async () => {
		vol.mkdirSync("/project", { recursive: true });
		vol.writeFileSync(
			"/project/.gitignore",
			"node_modules/\ndist/\n.launchpad/\n.downloads/\n.env.*.local\n.env.local\n",
		);

		const result = await applyGenerators(baseAnswers, mockDeps(baseAnswers));

		expect(result.skipped.some((s) => s.includes(".gitignore"))).toBe(true);
	});

	it("reflects created vs updated correctly for mixed scenario", async () => {
		vol.mkdirSync("/project", { recursive: true });
		// Existing package.json and tsconfig but no config or gitignore
		vol.writeFileSync("/project/package.json", JSON.stringify({ name: "my-app" }));
		vol.writeFileSync(
			"/project/tsconfig.json",
			JSON.stringify({ compilerOptions: { module: "NodeNext" } }),
		);

		const result = await applyGenerators(baseAnswers, mockDeps(baseAnswers));

		expect(result.updated).toContain("package.json");
		expect(result.updated).toContain("tsconfig.json");
		expect(result.created).toContain("launchpad.config.ts");
		expect(result.created).toContain(".gitignore");
	});
});
