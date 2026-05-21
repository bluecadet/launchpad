const LAUNCHPAD_ENTRIES = [
	"node_modules/",
	"dist/",
	".launchpad/",
	".downloads/",
	".env.*.local",
	".env.local",
];

const SECTION_MARKER = "# Added by create-launchpad";

export function generateGitignore(): string {
	return [SECTION_MARKER, ...LAUNCHPAD_ENTRIES, ""].join("\n");
}

export function mergeGitignore(existing: string): string {
	const lines = existing.split("\n");
	const missing = LAUNCHPAD_ENTRIES.filter((entry) => !lines.includes(entry));

	if (missing.length === 0) return existing;

	const trimmed = existing.endsWith("\n") ? existing.slice(0, -1) : existing;
	return `${trimmed}\n\n${SECTION_MARKER}\n${missing.join("\n")}\n`;
}
