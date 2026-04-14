export type ContentSource = "airtable" | "contentful" | "json" | "sanity" | "strapi";

export type ContentTransform =
	| "mdToHtml"
	| "mediaDownloader"
	| "sanityToHtml"
	| "sanityToMarkdown"
	| "sanityToPlain"
	| "sanityImageUrlTransform"
	| "sharp"
	| "symlink";

export interface MonitorAppAnswers {
	name: string;
	script: string;
	cwd: string;
}

export interface Answers {
	targetDir: string;
	packageName: string;
	useContent: boolean;
	useMonitor: boolean;
	useDashboard: boolean;
	contentSources: ContentSource[];
	contentTransforms: ContentTransform[];
	monitorApps: MonitorAppAnswers[];
	addGitignore: boolean;
}

export interface ApplyResult {
	created: string[];
	updated: string[];
	skipped: string[];
	warnings: string[];
}
