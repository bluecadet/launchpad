import type { Answers } from "../types.js";

const CLIENT_PACKAGE = "@bluecadet/launchpad-client";
const CLIENT_DOCS_LINK = "https://bluecadet.github.io/launchpad/reference/client";

function buildGettingStarted(answers: Answers): string {
	const lines = ["## Getting started", "", "```bash", "npm install", "```", ""];

	if (answers.useContent) {
		lines.push("- `npm run content` fetches content from your configured sources.");
	}
	if (answers.useMonitor) {
		lines.push("- `npm run start` starts the controller.");
		lines.push("- `npm run stop` stops the controller.");
	}

	return lines.join("\n");
}

function buildConnectingAnApp(): string {
	return [
		"## Connecting an app",
		"",
		"Apps talk to this project's controller over HTTP and SSE.",
		`Use \`${CLIENT_PACKAGE}\` for that: it handles reconnects and missed updates.`,
		`Full API: ${CLIENT_DOCS_LINK}.`,
	].join("\n");
}

export function generateReadme(answers: Answers): string {
	return [
		`# ${answers.packageName}`,
		"",
		"A Launchpad-powered project scaffolded with `@bluecadet/create-launchpad`.",
		"",
		buildGettingStarted(answers),
		"",
		buildConnectingAnApp(),
		"",
	].join("\n");
}
