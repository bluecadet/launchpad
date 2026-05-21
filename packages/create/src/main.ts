import fs from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import {
	generateGitignore,
	generateLaunchpadConfig,
	generatePackageJson,
	generateTsconfig,
	getRequiredPackages,
	mergeGitignore,
	mergePackageJson,
	validateAndPatchTsconfig,
} from "./generators/index.js";
import type { Answers, ApplyResult, ContentSource, ContentTransform } from "./types.js";

export async function resolveVersions(packages: string[]): Promise<Record<string, string>> {
	const results = await Promise.allSettled(
		packages.map(async (pkg) => {
			const encoded = encodeURIComponent(pkg);
			const res = await fetch(`https://registry.npmjs.org/${encoded}/latest`);
			const data = (await res.json()) as { version: string };
			return [pkg, `^${data.version}`] as [string, string];
		}),
	);

	return Object.fromEntries(
		results.map((result, i) => {
			const pkg = packages[i] as string;
			return result.status === "fulfilled" ? result.value : [pkg, "latest"];
		}),
	);
}

function cancel(message = "Setup cancelled."): never {
	p.cancel(message);
	process.exit(0);
}

function guard<T>(value: T | symbol): T {
	if (p.isCancel(value)) cancel();
	return value as T;
}

async function readFile(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf-8");
	} catch {
		return null;
	}
}

export async function main(): Promise<void> {
	p.intro("@bluecadet/create-launchpad");

	const rawDir = guard(
		await p.text({
			message: "Where should we set up Launchpad?",
			initialValue: ".",
			placeholder: ".",
		}),
	);

	const targetDir = path.resolve(rawDir);

	// Ensure target directory exists
	await fs.mkdir(targetDir, { recursive: true });

	// Read existing package.json if present
	const existingPkg = await readFile(path.join(targetDir, "package.json"));
	let packageName: string;

	if (existingPkg) {
		const parsed = JSON.parse(existingPkg) as { name?: string };
		packageName = parsed.name ?? path.basename(targetDir);
		p.note(`Using existing package: ${packageName}`, "package.json found");
	} else {
		packageName = guard(
			await p.text({
				message: "Package name?",
				initialValue: path.basename(targetDir) || "my-installation",
			}),
		);
	}

	const plugins = guard(
		await p.multiselect<string>({
			message: "Which plugins do you need?",
			options: [
				{ value: "content", label: "Content  – fetch & transform data from CMS/APIs" },
				{ value: "monitor", label: "Monitor  – manage app processes via PM2" },
			],
			required: true,
		}),
	);

	const useContent = plugins.includes("content");
	const useMonitor = plugins.includes("monitor");

	let contentSources: ContentSource[] = [];
	let contentTransforms: ContentTransform[] = [];

	if (useContent) {
		contentSources = guard(
			await p.multiselect<ContentSource>({
				message: "Which content sources?",
				options: [
					{ value: "json", label: "JSON  – fetch from any JSON endpoint" },
					{ value: "sanity", label: "Sanity CMS" },
					{ value: "contentful", label: "Contentful" },
					{ value: "airtable", label: "Airtable" },
					{ value: "strapi", label: "Strapi" },
				],
				required: false,
			}),
		);

		contentTransforms = guard(
			await p.multiselect<ContentTransform>({
				message: "Any transforms? (optional)",
				options: [
					{
						value: "mediaDownloader",
						label: "Media Downloader  - download images/files to disk",
					},
					{ value: "mdToHtml", label: "Markdown → HTML" },
					{ value: "sharp", label: "Sharp  - image processing (requires sharp)" },
					{ value: "symlink", label: "Symlink  - create symlinks in downloads folder" },
					{ value: "sanityToHtml", label: "Sanity → HTML  (@portabletext/to-html)" },
					{
						value: "sanityToMarkdown",
						label: "Sanity → Markdown  (@sanity/block-content-to-markdown)",
					},
					{ value: "sanityToPlain", label: "Sanity → Plain text" },
					{ value: "sanityImageUrlTransform", label: "Sanity Image URL  (@sanity/image-url)" },
				],
				required: false,
			}),
		);
	}

	const monitorApps: { name: string; script: string; cwd: string }[] = [];
	if (useMonitor) {
		let addApp = guard(
			await p.confirm({ message: "Configure a monitor app now?", initialValue: true }),
		);
		while (addApp) {
			const app = guard(
				await p.group(
					{
						name: () => p.text({ message: "App name?", initialValue: "my-app" }),
						script: () => p.text({ message: "Script path?", placeholder: "./my-app.exe" }),
						cwd: () => p.text({ message: "Working directory?", initialValue: "./builds/" }),
					},
					{ onCancel: () => cancel() },
				),
			);
			monitorApps.push(app as { name: string; script: string; cwd: string });
			addApp = guard(await p.confirm({ message: "Add another app?", initialValue: false }));
		}
	}

	const addGitignore = guard(
		await p.confirm({
			message: "Add Launchpad entries to .gitignore?",
			initialValue: true,
		}),
	);

	const answers: Answers = {
		targetDir,
		packageName,
		useContent,
		useMonitor,
		contentSources,
		contentTransforms,
		monitorApps,
		addGitignore,
	};

	const spinner = p.spinner();
	spinner.start("Resolving package versions");
	const deps = await resolveVersions(getRequiredPackages(answers));
	spinner.message("Writing files");

	const result = await applyGenerators(answers, deps);

	spinner.stop("Files written");

	if (result.created.length > 0) {
		p.note(result.created.map((f) => `+ ${f}`).join("\n"), "Created");
	}
	if (result.updated.length > 0) {
		p.note(result.updated.map((f) => `~ ${f}`).join("\n"), "Updated");
	}
	if (result.warnings.length > 0) {
		p.note(result.warnings.join("\n"), "Warnings");
	}

	p.outro("Done! Run `npm install` to install the added dependencies.");
}

export async function applyGenerators(
	answers: Answers,
	deps?: Record<string, string>,
): Promise<ApplyResult> {
	const result: ApplyResult = { created: [], updated: [], skipped: [], warnings: [] };
	const { targetDir } = answers;

	const resolvedDeps = deps ?? (await resolveVersions(getRequiredPackages(answers)));

	// package.json
	const pkgPath = path.join(targetDir, "package.json");
	const existingPkg = await readFile(pkgPath);
	if (existingPkg) {
		const merged = mergePackageJson(existingPkg, answers, resolvedDeps);
		await fs.writeFile(pkgPath, merged, "utf-8");
		result.updated.push("package.json");
	} else {
		await fs.writeFile(pkgPath, generatePackageJson(answers, resolvedDeps), "utf-8");
		result.created.push("package.json");
	}

	// tsconfig.json
	const tsconfigPath = path.join(targetDir, "tsconfig.json");
	const existingTsconfig = await readFile(tsconfigPath);
	if (existingTsconfig) {
		const { content, warnings } = validateAndPatchTsconfig(existingTsconfig);
		await fs.writeFile(tsconfigPath, content, "utf-8");
		result.updated.push("tsconfig.json");
		result.warnings.push(...warnings);
	} else {
		await fs.writeFile(tsconfigPath, generateTsconfig(), "utf-8");
		result.created.push("tsconfig.json");
	}

	// launchpad.config.ts
	const configPath = path.join(targetDir, "launchpad.config.ts");
	const existingConfig = await readFile(configPath);
	if (existingConfig) {
		result.skipped.push("launchpad.config.ts (already exists — not overwritten)");
	} else {
		await fs.writeFile(configPath, generateLaunchpadConfig(answers), "utf-8");
		result.created.push("launchpad.config.ts");
	}

	// .gitignore
	if (answers.addGitignore) {
		const gitignorePath = path.join(targetDir, ".gitignore");
		const existingGitignore = await readFile(gitignorePath);
		if (existingGitignore) {
			const merged = mergeGitignore(existingGitignore);
			if (merged !== existingGitignore) {
				await fs.writeFile(gitignorePath, merged, "utf-8");
				result.updated.push(".gitignore");
			} else {
				result.skipped.push(".gitignore (entries already present)");
			}
		} else {
			await fs.writeFile(gitignorePath, generateGitignore(), "utf-8");
			result.created.push(".gitignore");
		}
	}

	return result;
}
