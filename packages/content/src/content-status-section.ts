import type { ContributedStatusSection } from "@bluecadet/launchpad-utils/status-registry";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";
import type { ContentState, SourceFetchState } from "./content-state.js";

function renderSource(sourceId: string, sourceState: SourceFetchState): string {
	let statusIcon = chalk.gray("○");
	let details = "";

	if (sourceState.state === "pending") {
		statusIcon = chalk.gray("○");
		details = "Pending";
	} else if (sourceState.state === "fetching") {
		statusIcon = chalk.yellow("●");
		details = "Fetching";
	} else if (sourceState.state === "success") {
		statusIcon = chalk.green("✓");
		const duration = (sourceState.duration / 1000).toFixed(1);
		details = `Success (${duration}s)`;
	} else if (sourceState.state === "error") {
		statusIcon = chalk.red("✗");
		details = `Error: ${sourceState.error.message}`;
		if (sourceState.restored) {
			details += " (restored from backup)";
		}
	}

	return `    ${statusIcon} ${sourceId}: ${details}\n`;
}

function renderContentState(contentState: ContentState): string {
	let output = `${chalk.bold("Content:")}\n`;
	output += `  Phase: ${contentState.phase}\n`;

	const { sources } = contentState;
	if (sources && Object.keys(sources).length > 0) {
		output += `  ${chalk.bold("Sources:")}\n`;
		for (const [sourceId, sourceState] of Object.entries(sources)) {
			output += renderSource(sourceId, sourceState);
		}
	}

	return output;
}

export const contentStatusSection: ContributedStatusSection = {
	order: 20,
	render(state: LaunchpadState): string | null {
		if (!state.plugins.content) {
			return null;
		}
		return renderContentState(state.plugins.content);
	},
};
