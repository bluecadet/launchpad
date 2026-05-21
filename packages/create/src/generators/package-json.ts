import type { Answers, ContentSource, ContentTransform } from "../types.js";

const LAUNCHPAD_PACKAGE = "@bluecadet/launchpad";

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
	const packages: string[] = [LAUNCHPAD_PACKAGE];

	if (answers.useContent) {
		for (const source of answers.contentSources) {
			packages.push(...(SOURCE_PEER_DEPS[source] ?? []));
		}
		for (const transform of answers.contentTransforms) {
			packages.push(...(TRANSFORM_PEER_DEPS[transform] ?? []));
		}
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

export function generatePackageJson(answers: Answers, deps: Record<string, string>): string {
	const scripts = getRequiredScripts(answers);

	const pkg = {
		name: answers.packageName,
		version: "0.1.0",
		type: "module",
		scripts,
		dependencies: deps,
	};

	return JSON.stringify(pkg, null, "\t");
}

export function mergePackageJson(
	existing: string,
	answers: Answers,
	deps: Record<string, string>,
): string {
	const pkg = JSON.parse(existing) as Record<string, unknown>;

	const existingDeps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
	const mergedDeps: Record<string, string> = { ...existingDeps };
	for (const [name, version] of Object.entries(deps)) {
		if (!(name in mergedDeps)) {
			mergedDeps[name] = version;
		}
	}
	pkg.dependencies = mergedDeps;

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
