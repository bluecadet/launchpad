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
				return client.queryState().andThen((state) => {
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
							`  Connected: ${state.subsystems.monitor.isConnected ? chalk.green("Yes") : chalk.red("No")}`,
						);

						// Apps
						if (
							state.subsystems.monitor.apps &&
							Object.keys(state.subsystems.monitor.apps).length > 0
						) {
							console.log(`\n${chalk.bold("Apps:")}`);
							for (const [appName, appStatus] of Object.entries(state.subsystems.monitor.apps)) {
								const icon = appStatus.status === "online" ? "●" : "○";
								const statusColor = appStatus.status === "online" ? chalk.green : chalk.red;
								console.log(
									`  ${statusColor(icon)} ${appName}: ${statusColor(appStatus.status)}${appStatus.pid ? ` (PID: ${appStatus.pid})` : ""}`,
								);
							}
						}
					}

					// Content status
					if (state.subsystems.content) {
						console.log(`\n${chalk.bold("Content:")}`);
						const contentState = state.subsystems.content;
						const sources = contentState.sources;

						// Show overall phase
						console.log(`  Phase: ${contentState.phase.phase}`);

						if (sources && Object.keys(sources).length > 0) {
							for (const [sourceId, sourceState] of Object.entries(sources)) {
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

								console.log(`  ${statusIcon} ${sourceId}: ${details}`);
							}
						}
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
