import { z } from "zod";
import type { DashboardPage } from "./dashboard-page.js";
import type { DashboardPanel } from "./dashboard-panel.js";

function isValidPage(val: unknown): val is DashboardPage {
	if (typeof val !== "object" || val === null) return false;
	const obj = val as Record<string, unknown>;
	return typeof obj.id === "string" && typeof obj.title === "string";
}

function isValidPanel(val: unknown): val is DashboardPanel {
	return isValidPage(val) && typeof (val as Record<string, unknown>).render === "function";
}

export const dashboardConfigSchema = z.object({
	/** Port for the HTTP server. Defaults to 3000. */
	port: z.number().int().min(1).max(65535).default(3000),
	/**
	 * Host/bind address. Defaults to "localhost" (loopback only).
	 * Set to "0.0.0.0" to expose on all network interfaces.
	 */
	host: z.string().default("localhost"),
	/** Full pages shown in the dashboard navigation. */
	pages: z.array(z.custom<DashboardPage>(isValidPage)).default([]),
	/**
	 * Standalone panels shown on the auto-generated Overview page.
	 * If empty and no pages are configured, the dashboard shows a blank overview.
	 */
	panels: z.array(z.custom<DashboardPanel>(isValidPanel)).default([]),
	/**
	 * Log panel configuration. Enabled by default.
	 * Set to false to disable the log panel entirely.
	 */
	logs: z
		.union([
			z.object({
				/**
				 * Maximum number of log entries to keep in memory.
				 * When full, the oldest entry is evicted. Defaults to 500.
				 */
				maxEntries: z.number().int().min(1).default(500),
			}),
			z.literal(false),
		])
		.default({ maxEntries: 500 }),
});

export type DashboardConfig = z.input<typeof dashboardConfigSchema>;
export type ResolvedDashboardConfig = z.output<typeof dashboardConfigSchema>;

export function defineDashboardConfig(config: DashboardConfig): DashboardConfig {
	return config;
}
