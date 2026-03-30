import type { ContributedStatusSection } from "@bluecadet/launchpad-utils/status-registry";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";

export const monitorStatusSection: ContributedStatusSection = {
	order: 10,
	render(state: LaunchpadState): string | null {
		if (!state.plugins.monitor) {
			return null;
		}

		let output = `\n${chalk.bold("Monitor:")}\n`;
		output += `  Connected: ${state.plugins.monitor.isConnected ? chalk.green("Yes") : chalk.red("No")}`;

		if (state.plugins.monitor.apps && Object.keys(state.plugins.monitor.apps).length > 0) {
			output += `\n  ${chalk.bold("Apps:")}\n`;
			for (const [appName, appStatus] of Object.entries(state.plugins.monitor.apps)) {
				const icon = appStatus.status === "online" ? "●" : "○";
				const statusColor = appStatus.status === "online" ? chalk.green : chalk.red;
				output += `    ${statusColor(icon)} ${appName}: ${statusColor(appStatus.status)}${appStatus.pid ? ` (PID: ${appStatus.pid})` : ""}\n`;
			}
		}

		return output;
	},
};
