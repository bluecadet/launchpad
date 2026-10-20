import type { Answers, ContentSource, ContentTransform } from "../types.js";

const LAUNCHPAD_PACKAGE = "@bluecadet/launchpad";
const NODE_ENGINE = "^24 || >=26";
const DEV_PACKAGES = new Set(["@types/node"]);

const SOURCE_PEER_DEPS: Partial<Record<ContentSource, string[]>> = {
	sanity: ["@sanity/client"],
	contentful: ["contentful"],
	airtable: ["airtable"],
};

const TRANSFORM_PEER_DEPS: Partial<Record<ContentTransform, string[]>> = {
	sanityToHtml: ["@portabletext/to-html"],
	sanityToMarkdown: ["@sanity/block-content-to-markdown"],
	sanityImageUrlTransform: ["@sanity/image-url"],
	sharp: ["sharp"],
};

export function getRequiredPackages(answers: Answers): string[] {
	const packages: string[] = [LAUNCHPAD_PACKAGE, ...DEV_PACKAGES];

	if (answers.useContent) {
		for (const source of answers.contentSources) {
			packages.push(...(SOURCE_PEER_DEPS[source] ?? []));
		}
		for (const transform of answers.contentTransforms) {
			packages.push(...(TRANSFORM_PEER_DEPS[transform] ?? []));
		}
	}

	if (answers.useScheduler) {
		packages.push("@bluecadet/launchpad-scheduler");
	}

	return packages;
}

function getRequiredScripts(answers: Answers): Record<string, string> {
	const scripts: Record<string, string> = {};
	if (answers.useContent) {
		scripts.content = "launchpad content";
	}
	if (answers.useMonitor) {
		scripts.start = "launchpad start";
		scripts.stop = "launchpad stop";
	}
	return scripts;
}

function splitDeps(deps: Record<string, string>) {
	const dependencies: Record<string, string> = {};
	const devDependencies: Record<string, string> = {};
	for (const [name, version] of Object.entries(deps)) {
		(DEV_PACKAGES.has(name) ? devDependencies : dependencies)[name] = version;
	}
	return { dependencies, devDependencies };
}

export function generatePackageJson(answers: Answers, deps: Record<string, string>): string {
	const scripts = getRequiredScripts(answers);

	const pkg = {
		name: answers.packageName,
		version: "0.1.0",
		type: "module",
		engines: { node: NODE_ENGINE },
		scripts,
		...splitDeps(deps),
	};

	return JSON.stringify(pkg, null, "\t");
}

export function mergePackageJson(
	existing: string,
	answers: Answers,
	deps: Record<string, string>,
): string {
	const pkg = JSON.parse(existing) as Record<string, unknown>;

	const existingEngines = (pkg.engines as Record<string, string> | undefined) ?? {};
	pkg.engines = { node: NODE_ENGINE, ...existingEngines };

	const existingDeps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
	const existingDevDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
	const { dependencies, devDependencies } = splitDeps(deps);
	const isInstalled = (name: string) => name in existingDeps || name in existingDevDeps;
	const missing = (incoming: Record<string, string>) =>
		Object.fromEntries(Object.entries(incoming).filter(([name]) => !isInstalled(name)));
	pkg.dependencies = { ...existingDeps, ...missing(dependencies) };
	const mergedDevDeps = { ...existingDevDeps, ...missing(devDependencies) };
	if (Object.keys(mergedDevDeps).length > 0) {
		pkg.devDependencies = mergedDevDeps;
	}

	const newScripts = getRequiredScripts(answers);
	const existingScripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
	const mergedScripts: Record<string, string> = { ...existingScripts };
	for (const [name, cmd] of Object.entries(newScripts)) {
		if (!(name in mergedScripts)) {
			mergedScripts[name] = cmd;
		}
	}
	pkg.scripts = mergedScripts;

	return JSON.stringify(pkg, null, "\t");
}
