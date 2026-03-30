import type { ContributedStatusSection } from "@bluecadet/launchpad-utils/status-registry";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";
import type { DashboardState } from "./dashboard-state.js";

export const dashboardStatusSection: ContributedStatusSection = {
	order: 30,
	render(state: LaunchpadState): string | null {
		const dashboard = state.plugins.dashboard as DashboardState | undefined;
		if (!dashboard) {
			return null;
		}

		const lines: string[] = [chalk.bold("Dashboard:")];

		if (dashboard.isRunning) {
			lines.push(`  Status: ${chalk.green("Running")}`);
			lines.push(`  URL: http://${dashboard.host}:${dashboard.port}`);
		} else {
			lines.push(`  Status: ${chalk.red("Stopped")}`);
		}

		return lines.join("\n");
	},
};
