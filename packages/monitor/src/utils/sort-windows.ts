import type { Logger } from "@bluecadet/launchpad-utils/logger";
import chalk from "chalk";
import type { ResolvedAppConfig } from "../monitor-config.js";
import { getWindowsNative, type WindowAction } from "./windows-native.js";

type SortApp = {
	options: ResolvedAppConfig;
	pid?: number;
};

const windowActions: { action: WindowAction; label: string }[] = [
	{ action: "hide", label: "Hiding" },
	{ action: "minimize", label: "Minimizing" },
	{ action: "foreground", label: "Foregrounding" },
];

const sortWindows = async (apps: SortApp[], logger: Logger): Promise<void> => {
	logger.verbose(
		`Applying window settings to ${apps.length} ${apps.length === 1 ? "app" : "apps"}`,
	);

	const actionsByPid = new Map<number, Set<WindowAction>>();
	const managedApps: { options: ResolvedAppConfig; pid: number }[] = [];
	for (const app of apps) {
		if (!app.pid) {
			logger.warn(
				`Can't sort windows for ${chalk.blue(app.options.pm2.name)} because it has no pid.`,
			);
			continue;
		}

		const actions = windowActions.filter(({ action }) => app.options.windows[action]);
		if (actions.length === 0) {
			continue;
		}
		managedApps.push({ options: app.options, pid: app.pid });
		const pidActions = actionsByPid.get(app.pid) ?? new Set<WindowAction>();
		for (const { action } of actions) {
			pidActions.add(action);
		}
		actionsByPid.set(app.pid, pidActions);
	}

	// Empty and unflagged batches need neither the addon nor a window snapshot.
	const native = actionsByPid.size > 0 ? getWindowsNative() : undefined;
	if (!native) {
		logger.verbose("Done applying window settings.");
		return;
	}

	const visibleWindows = native.listVisibleWindows();
	const visiblePids = new Set(visibleWindows.map((window) => window.processId));
	for (const app of managedApps) {
		if (!visiblePids.has(app.pid)) {
			logger.warn(
				`No window found for ${chalk.blue(app.options.pm2.name)} with pid ${chalk.blue(app.pid)}.`,
			);
		}
	}

	for (const window of visibleWindows) {
		const actions = actionsByPid.get(window.processId);
		for (const { action, label } of windowActions) {
			if (!actions?.has(action)) {
				continue;
			}
			logger.info(
				`${label} ${chalk.blue(native.getWindowTitle(window))} (pid: ${chalk.blue(window.processId)})`,
			);
			await native.applyWindowAction(window, action);
		}
	}

	logger.verbose("Done applying window settings.");
};

export default sortWindows;
