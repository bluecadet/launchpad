/**
 * Status command - Query the persistent controller's current state via IPC
 */

import type { LaunchpadState } from "@bluecadet/launchpad-controller";
import { onExit } from "@bluecadet/launchpad-utils/on-exit";
import chalk from "chalk";
import { okAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemon } from "../utils/controller-execution.js";

export function status(argv: GlobalLaunchpadArgs & { watch?: boolean }) {
	return loadConfigAndEnv(argv)
		.andThen(({ dir, config }) => {
			return withDaemon(dir, config.controller, false, (client) => {
				return client.queryState().andThen((state) => {
					if (!argv.watch) {
						cliLogger.fixed(stateToString(state));
						return okAsync(state);
					}

					// Watch mode
					const str = stateToString(state);
					cliLogger.fixed(str);

					client.onStateChange((newState) => {
						const newStr = stateToString(newState);
						cliLogger.fixed(`${newStr}"\nWatching for status changes... (press Ctrl+C to exit)"`);
					});
					const neverResolve = new Promise<void>((resolve) => {
						// resolve on sigint / sigterm / sigkill / etc
						onExit(() => {
							resolve();
						});
					});
					return ResultAsync.fromSafePromise(neverResolve);
				});
			});
		})
		.orElse((error) => handleFatalError(error));
}
function stateToString(state: LaunchpadState): string {
	let output = "";

	// Pretty print the state
	output += `${chalk.bold("Launchpad Status:")}\n`;

	if (state.system?.startTime) {
		const uptime = Date.now() - new Date(state.system.startTime).getTime();
		output += `  Uptime: ${formatUptime(uptime)}\n`;
	}

	// Monitor status
	if (state.subsystems.monitor) {
		output += `\n${chalk.bold("Monitor:")}\n`;
		output += `  Connected: ${state.subsystems.monitor.isConnected ? chalk.green("Yes") : chalk.red("No")}\n`;

		// Apps
		if (state.subsystems.monitor.apps && Object.keys(state.subsystems.monitor.apps).length > 0) {
			output += `\n${chalk.bold("Apps:")}\n`;
			for (const [appName, appStatus] of Object.entries(state.subsystems.monitor.apps)) {
				const icon = appStatus.status === "online" ? "●" : "○";
				const statusColor = appStatus.status === "online" ? chalk.green : chalk.red;
				output += `  ${statusColor(icon)} ${appName}: ${statusColor(appStatus.status)}${appStatus.pid ? ` (PID: ${appStatus.pid})` : ""}\n`;
			}
		}
	}

	// Content status
	if (state.subsystems.content) {
		output += `\n${chalk.bold("Content:")}\n`;
		const contentState = state.subsystems.content;
		const sources = contentState.sources;

		// Show overall phase
		output += `  Phase: ${contentState.phase}\n`;

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

				output += `  ${statusIcon} ${sourceId}: ${details}\n`;
			}
		}
	}

	return output;
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
