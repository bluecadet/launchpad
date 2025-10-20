/**
 * Status command - Query the persistent controller's current state via IPC
 */

import { okAsync } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemon } from "../utils/controller-execution.js";

export function status(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.andThen(({ dir, config }) => {
			return withDaemon(dir, config.controller, (client) => {
				return client
					.queryState()
					.mapErr((e) => e as Error)
					.andThen((stateValue) => {
						// biome-ignore lint/suspicious/noExplicitAny: TODO: improve typing, add some type guards
						const state = stateValue as any;

						// Pretty print the state
						console.log("Launchpad Status:");

						if (state.system?.startTime) {
							const uptime = Date.now() - new Date(state.system.startTime).getTime();
							console.log(`  Uptime: ${formatUptime(uptime)}`);
						}

						// Monitor status
						if (state.monitor) {
							console.log("\nMonitor:");
							console.log(`  Connected: ${state.monitor.connected ? "Yes" : "No"}`);
							if (state.monitor.pm2Version) {
								console.log(`  PM2 Version: ${state.monitor.pm2Version}`);
							}

							// Apps
							if (state.monitor.apps && Object.keys(state.monitor.apps).length > 0) {
								console.log("\nApps:");
								for (const [appName, appStatus] of Object.entries(state.monitor.apps)) {
									// biome-ignore lint/suspicious/noExplicitAny: TODO: improve typing, add some type guards
									const app = appStatus as any;
									const icon = app.status === "online" ? "●" : "○";
									const statusColor = app.status === "online" ? "\x1b[32m" : "\x1b[31m";
									const reset = "\x1b[0m";
									console.log(
										`  ${statusColor}${icon}${reset} ${appName}: ${app.status}${app.pid ? ` (PID: ${app.pid})` : ""}`,
									);
								}
							}
						}

						// Content status
						if (state.content) {
							console.log("\nContent:");
							console.log(`  Last Fetch: ${state.content.lastFetch || "Never"}`);
							console.log(`  In Progress: ${state.content.inProgress ? "Yes" : "No"}`);
						}

						return okAsync(state);
					});
			});
		})
		.mapErr(() => {
			console.error("Launchpad is not running");
			console.error("Start it with: launchpad start");
			process.exit(1);
		});
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ${hours % 24}h ${minutes % 60}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}
