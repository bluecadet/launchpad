/**
 * Dashboard plugin command types.
 */
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";

export type DashboardStartCommand = BaseCommand & {
	type: "dashboard.start";
};

export type DashboardStopCommand = BaseCommand & {
	type: "dashboard.stop";
};

export type DashboardCommand = DashboardStartCommand | DashboardStopCommand;

export type DashboardCommandMap = {
	"dashboard.start": { input: DashboardStartCommand; output: undefined };
	"dashboard.stop": { input: DashboardStopCommand; output: undefined };
};

export const dashboardStartCommandSchema = z
	.object({
		type: z.literal("dashboard.start"),
	})
	.strict();

export const dashboardStopCommandSchema = z
	.object({
		type: z.literal("dashboard.stop"),
	})
	.strict();

export const dashboardCommandSchema = z.discriminatedUnion("type", [
	dashboardStartCommandSchema,
	dashboardStopCommandSchema,
]);
