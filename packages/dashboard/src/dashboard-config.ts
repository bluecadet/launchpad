import { z } from "zod";
import type { DashboardPage } from "./dashboard-page.js";
import type { DashboardPanel } from "./dashboard-panel.js";

export const dashboardConfigSchema = z.object({
	/** Port for the HTTP server. Defaults to 3000. */
	port: z.number().int().min(1).max(65535).default(3000),
	/**
	 * Host/bind address. Defaults to "localhost" (loopback only).
	 * Set to "0.0.0.0" to expose on all network interfaces.
	 */
	host: z.string().default("localhost"),
	/** Full pages shown in the dashboard navigation. */
	pages: z.array(z.custom<DashboardPage>()).default([]),
	/**
	 * Standalone panels shown on the auto-generated Overview page.
	 * If empty and no pages are configured, the dashboard shows a blank overview.
	 */
	panels: z.array(z.custom<DashboardPanel>()).default([]),
});

export type DashboardConfig = z.input<typeof dashboardConfigSchema>;
export type ResolvedDashboardConfig = z.output<typeof dashboardConfigSchema>;

export function defineDashboardConfig(config: DashboardConfig): DashboardConfig {
	return config;
}
