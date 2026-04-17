/**
 * Status command - Query the persistent controller's current state via IPC
 */

import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { DashboardRegistry } from "@bluecadet/launchpad-utils/panel-registry";
import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import {
	type ContributedStatusSection,
	StatusRegistry,
} from "@bluecadet/launchpad-utils/status-registry";
import type { LaunchpadState, VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import chalk from "chalk";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemon } from "../utils/controller-execution.js";
import { onTerminate } from "../utils/on-terminate.js";

const watchMessage = chalk.dim("Watching for status changes... (press Ctrl+C to exit)");
const BUILTIN_STATUS_PLUGIN_NAMES = new Set(["content", "monitor", "dashboard"]);

export function status(argv: GlobalLaunchpadArgs & { watch?: boolean }) {
	return loadConfigAndEnv(argv)
		.andThen(({ dir, config }) =>
			ResultAsync.fromPromise(createStatusRegistry(config.plugins ?? [], dir), toError).andThen(
				(statusRegistry) =>
					withDaemon(dir, config.controller, false, (client) => {
						return client.queryState().andThen((state) => {
							if (!argv.watch) {
								cliLogger.fixed(stateToString(state, statusRegistry));
								return okAsync(state);
							}

							cliLogger.fixed(`${stateToString(state, statusRegistry)}\n${watchMessage}`);

							client.onStateChange((newState) => {
								cliLogger.fixed(`${stateToString(newState, statusRegistry)}\n${watchMessage}`);
							});

							const neverResolve = new Promise<void>((resolve) => {
								// resolve on sigint / sigterm
								onTerminate(() => {
									resolve();
								});
							});
							return ResultAsync.fromSafePromise(neverResolve);
						});
					}),
			),
		)
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

async function createStatusRegistry(
	plugins: readonly PluginConfig[],
	cwd: string,
): Promise<StatusRegistry> {
	const localStatusRegistry = new StatusRegistry();
	localStatusRegistry.contributeStatusSection(...(await loadCliStatusSections()));
	localStatusRegistry.contributeStatusSection(
		...(await loadConfiguredStatusSections(plugins, cwd)),
	);
	return localStatusRegistry;
}

async function loadConfiguredStatusSections(
	plugins: readonly PluginConfig[],
	cwd: string,
): Promise<ContributedStatusSection[]> {
	const localStatusRegistry = new StatusRegistry();
	const pluginCtx = createStatusPluginContext(localStatusRegistry, cwd);

	for (const plugin of plugins) {
		if (BUILTIN_STATUS_PLUGIN_NAMES.has(plugin.name)) {
			continue;
		}

		try {
			await plugin.setup(pluginCtx);
		} catch {
			// Ignore plugin setup failures here so status rendering can fall back to core sections.
		}
	}

	return [...localStatusRegistry.getSections()];
}

function createStatusPluginContext(statusRegistry: StatusRegistry, cwd: string) {
	const abortController = new AbortController();
	abortController.abort();

	const noopLogger = createNoopLogger();
	const emptyState: VersionedLaunchpadState = {
		system: { mode: "task", startTime: new Date(0) },
		plugins: {},
		_version: 0,
	};

	return {
		eventBus: new EventBus(),
		logger: noopLogger,
		abortSignal: abortController.signal,
		cwd,
		dispatchCommand: () =>
			errAsync(new Error("dispatchCommand is unavailable while rendering status")),
		getGlobalState: () => emptyState,
		onGlobalStatePatch: () => () => {},
		updateState: () => {},
		dashboardRegistry: new DashboardRegistry(),
		statusRegistry,
	};
}

function createNoopLogger(): Logger {
	return {
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
		verbose: () => {},
		child: () => createNoopLogger(),
	};
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function stateToString(state: LaunchpadState, statusRegistry: StatusRegistry): string {
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
