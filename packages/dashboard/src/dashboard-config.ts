import { z } from "zod";
// need to import so declaration merging works
import "@bluecadet/launchpad-utils/types";

/**
 * Top-level options of Launchpad Dashbiard.
 */
export const dashboardConfigSchema = z.object({
	/** Port to serve local dashboard webserver on */
	port: z.number().default(4321).describe("Port to serve local dashboard webserver on"),
	/** Host to serve local dashboard webserver on */
	host: z.string().default("localhost").describe("Host to serve local dashboard webserver on"),
});

export type DashboardConfig = z.input<typeof dashboardConfigSchema>;
export type ResolvedDashboardConfig = z.output<typeof dashboardConfigSchema>;

export function defineDashboardConfig(config: DashboardConfig) {
	return config;
}

// Declaration merging to add dashboard config to LaunchpadConfig
declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadConfig {
		/**
		 * Dashboard system configuration.
		 */
		dashboard?: DashboardConfig;
	}
}
