/**
 * Status command - Query the persistent controller's current state via IPC
 */

import chalk from "chalk";
import { okAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemon } from "../utils/controller-execution.js";

export function status(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.andThen(({ dir, config }) => {
			return withDaemon(dir, config.controller, (client) => {
				return client.queryState().andThen((stateValue) => {
					// biome-ignore lint/suspicious/noExplicitAny: TODO: improve typing, add some type guards
					const state = stateValue as any;

					// Pretty print the state
					console.log(chalk.bold("Launchpad Status:"));

					if (state.system?.startTime) {
						const uptime = Date.now() - new Date(state.system.startTime).getTime();
						console.log(`  Uptime: ${formatUptime(uptime)}`);
					}

					// Monitor status
					if (state.subsystems.monitor) {
						console.log(`\n${chalk.bold("Monitor:")}`);
						console.log(
							`  Connected: ${state.subsystems.monitor.connected ? chalk.green("Yes") : chalk.red("No")}`,
						);
						if (state.subsystems.monitor.pm2Version) {
							console.log(`  PM2 Version: ${state.subsystems.monitor.pm2Version}`);
						}

						// Apps
						if (
							state.subsystems.monitor.apps &&
							Object.keys(state.subsystems.monitor.apps).length > 0
						) {
							console.log(`\n${chalk.bold("Apps:")}`);
							for (const [appName, appStatus] of Object.entries(state.subsystems.monitor.apps)) {
								// biome-ignore lint/suspicious/noExplicitAny: TODO: improve typing, add some type guards
								const app = appStatus as any;
								const icon = app.status === "online" ? "●" : "○";
								const statusColor = app.status === "online" ? chalk.green : chalk.red;
								console.log(
									`  ${statusColor(icon)} ${appName}: ${statusColor(app.status)}${app.pid ? ` (PID: ${app.pid})` : ""}`,
								);
							}
						}
					}

					// Content status
					if (state.subsystems.content) {
						console.log(`\n${chalk.bold("Content:")}`);
						console.log(`  Last Fetch: ${state.subsystems.content.lastFetch || "Never"}`);
						console.log(
							`  In Progress: ${state.subsystems.content.inProgress ? chalk.yellow("Yes") : chalk.green("No")}`,
						);
					}

					return okAsync(state);
				});
			});
		})
		.mapErr(() => {
			console.error(chalk.red("Launchpad is not running"));
			console.error(`Start it with: ${chalk.cyan("launchpad start")}`);
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
