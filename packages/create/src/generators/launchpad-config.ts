import dedent from "dedent";
import type { Answers, ContentSource, ContentTransform, MonitorAppAnswers } from "../types.js";

const SOURCE_NAMED: Record<ContentSource, string> = {
	json: "jsonSource",
	airtable: "airtableSource",
	contentful: "contentfulSource",
	sanity: "sanitySource",
	strapi: "strapiSource",
};

const TRANSFORM_NAMED: Record<ContentTransform, string> = {
	mdToHtml: "mdToHtml",
	mediaDownloader: "mediaDownloader",
	sanityImageUrlTransform: "sanityImageUrlTransform",
	sanityToHtml: "sanityToHtml",
	sanityToMarkdown: "sanityToMarkdown",
	sanityToPlain: "sanityToPlain",
	sharp: "sharp",
	symlink: "symlink",
};

/** Prepend `level` tabs to every non-empty line of `str`. */
function addIndent(str: string, level: number): string {
	if (level === 0) return str;
	const prefix = "\t".repeat(level);
	return str
		.split("\n")
		.map((line) => (line ? `${prefix}${line}` : ""))
		.join("\n");
}

function buildImports(answers: Answers): string {
	const lines: string[] = [`import { defineConfig } from '@bluecadet/launchpad-cli';`];

	if (answers.useContent) {
		lines.push(`import { content } from '@bluecadet/launchpad-content/launchpad-content';`);

		if (answers.contentSources.length > 0) {
			const named = answers.contentSources.map((s) => SOURCE_NAMED[s]).join(", ");
			lines.push(`import { ${named} } from '@bluecadet/launchpad-content/sources';`);
		}

		if (answers.contentTransforms.length > 0) {
			const named = answers.contentTransforms.map((t) => TRANSFORM_NAMED[t]).join(", ");
			lines.push(`import { ${named} } from '@bluecadet/launchpad-content/transforms';`);
		}
	}

	if (answers.useMonitor) {
		lines.push(`import { monitor } from '@bluecadet/launchpad-monitor/launchpad-monitor';`);
	}

	if (answers.useDashboard) {
		lines.push(`import { dashboard } from '@bluecadet/launchpad-dashboard';`);
	}

	return lines.join("\n");
}

// Each build* function returns a string at indent level 0.
// Callers use addIndent() to place it at the right depth.

function buildSource(source: ContentSource): string {
	switch (source) {
		case "json":
			return dedent`
				jsonSource({
					id: 'my-content',
					files: {
						// 'output.json': 'https://example.com/api/data',
					},
				})
			`;
		case "sanity":
			return dedent`
				sanitySource({
					id: 'my-sanity',
					projectId: 'your-project-id',
					dataset: 'production',
					queries: [
						// '*[_type == "page"]',
					],
				})
			`;
		case "contentful":
			return dedent`
				contentfulSource({
					id: 'my-contentful',
					space: 'your-space-id',
					deliveryToken: 'your-delivery-token',
				})
			`;
		case "airtable":
			return dedent`
				airtableSource({
					id: 'my-airtable',
					baseId: 'your-base-id',
					apiKey: 'your-api-key',
					tables: ['Table 1'],
				})
			`;
		case "strapi":
			return dedent`
				strapiSource({
					id: 'my-strapi',
					baseUrl: 'http://localhost:1337',
					queries: ['/api/articles'],
				})
			`;
	}
}

function buildTransform(transform: ContentTransform): string {
	switch (transform) {
		case "mediaDownloader":
			return "mediaDownloader()";
		case "mdToHtml":
			return "mdToHtml({ path: '$.some.json.path' })";
		case "sharp":
			return "sharp({ buildTransform: (img) => img.resize(1920) })";
		case "symlink":
			return "symlink({ path: './public/content', target: '.downloads/' })";
		case "sanityToHtml":
			return "sanityToHtml({ path: '$.some.json.path' })";
		case "sanityToMarkdown":
			return "sanityToMarkdown({ path: '$.some.json.path' })";
		case "sanityToPlain":
			return "sanityToPlain({ path: '$.some.json.path' })";
		case "sanityImageUrlTransform":
			return "sanityImageUrlTransform({ path: '$.some.json.path' })";
	}
}

function buildContentPlugin(answers: Answers): string {
	const sourcesBlock = answers.contentSources
		.map((s) => `${addIndent(buildSource(s), 2)},`)
		.join("\n");

	const lines = ["content({", "\tsources: [", sourcesBlock, "\t],"];

	if (answers.contentTransforms.length > 0) {
		const transformsBlock = answers.contentTransforms
			.map((t) => `${addIndent(buildTransform(t), 2)},`)
			.join("\n");
		lines.push("\ttransforms: [", transformsBlock, "\t],");
	}

	lines.push("})");
	return lines.join("\n");
}

function buildMonitorApp(app: MonitorAppAnswers): string {
	return dedent`
		{
			pm2: {
				name: '${app.name}',
				script: '${app.script}',
				cwd: '${app.cwd}',
			},
		}
	`;
}

function buildMonitorPlugin(answers: Answers): string {
	if (answers.monitorApps.length === 0) {
		return "monitor({\n\tapps: [],\n})";
	}

	const appsBlock = answers.monitorApps
		.map((app) => `${addIndent(buildMonitorApp(app), 2)},`)
		.join("\n");

	return ["monitor({", "\tapps: [", appsBlock, "\t],", "})"].join("\n");
}

function buildDashboardPlugin(): string {
	return "dashboard({\n\tport: 3000,\n})";
}

export function generateLaunchpadConfig(answers: Answers): string {
	const importsBlock = buildImports(answers);

	const plugins: string[] = [];
	if (answers.useContent) plugins.push(buildContentPlugin(answers));
	if (answers.useMonitor) plugins.push(buildMonitorPlugin(answers));
	if (answers.useDashboard) plugins.push(buildDashboardPlugin());

	const pluginsBlock = plugins.map((p) => `${addIndent(p, 2)},`).join("\n");

	return [
		importsBlock,
		"",
		"export default defineConfig({",
		"\tplugins: [",
		pluginsBlock,
		"\t],",
		"});",
		"",
	].join("\n");
}
