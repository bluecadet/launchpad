/**
 * Dashboard plugin command types.
 */
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";

export type DashboardStartCommand = BaseCommand & {
	type: "dashboard.start";
};

export type DashboardStopCommand = BaseCommand & {
	type: "dashboard.stop";
};

export type DashboardCommand = DashboardStartCommand | DashboardStopCommand;
