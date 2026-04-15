/**
 * Status command - Query the persistent controller's current state via IPC
 */

import {
	type ContributedStatusSection,
	StatusRegistry,
} from "@bluecadet/launchpad-utils/status-registry";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";
import { okAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemon } from "../utils/controller-execution.js";
import { onTerminate } from "../utils/on-terminate.js";

const watchMessage = chalk.dim("Watching for status changes... (press Ctrl+C to exit)");
const statusRegistry = await createStatusRegistry();

export function status(argv: GlobalLaunchpadArgs & { watch?: boolean }) {
	return loadConfigAndEnv(argv)
		.andThen(({ dir, config }) => {
			return withDaemon(dir, config.controller, false, (client) => {
				return client.queryState().andThen((state) => {
					if (!argv.watch) {
						cliLogger.fixed(stateToString(state));
						return okAsync(state);
					}

					cliLogger.fixed(`${stateToString(state)}\n${watchMessage}`);

					client.onStateChange((newState) => {
						cliLogger.fixed(`${stateToString(newState)}\n${watchMessage}`);
					});

					const neverResolve = new Promise<void>((resolve) => {
						// resolve on sigint / sigterm
						onTerminate(() => {
							resolve();
						});
					});
					return ResultAsync.fromSafePromise(neverResolve);
				});
			});
		})
		.orElse((error) => handleFatalError(error));
}

async function loadCliStatusSections(): Promise<ContributedStatusSection[]> {
	const loadedSections = await Promise.all([
		loadOptionalStatusSection(() =>
			import("@bluecadet/launchpad-content").then((module) => module.contentStatusSection),
		),
		loadOptionalStatusSection(() =>
			import("@bluecadet/launchpad-monitor").then((module) => module.monitorStatusSection),
		),
		loadOptionalStatusSection(() =>
			import("@bluecadet/launchpad-dashboard").then((module) => module.dashboardStatusSection),
		),
	]);

	return loadedSections.flatMap((section) => (section ? [section] : []));
}

async function loadOptionalStatusSection(
	loader: () => Promise<unknown>,
): Promise<ContributedStatusSection | null> {
	try {
		const section = await loader();
		return isContributedStatusSection(section) ? section : null;
	} catch {
		return null;
	}
}

function isContributedStatusSection(value: unknown): value is ContributedStatusSection {
	return (
		typeof value === "object" &&
		value !== null &&
		"render" in value &&
		typeof value.render === "function"
	);
}

async function createStatusRegistry(): Promise<StatusRegistry> {
	const localStatusRegistry = new StatusRegistry();
	localStatusRegistry.contributeStatusSection(...(await loadCliStatusSections()));
	return localStatusRegistry;
}

function stateToString(state: LaunchpadState): string {
	let output = `${chalk.bold("Launchpad Status:")}\n`;

	if (state.system?.startTime) {
		const uptime = Date.now() - new Date(state.system.startTime).getTime();
		output += `  Uptime: ${formatUptime(uptime)}\n`;
	}

	for (const section of statusRegistry.getSections()) {
		const rendered = section.render(state);
		if (rendered) {
			output += rendered;
			output += "\n";
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
