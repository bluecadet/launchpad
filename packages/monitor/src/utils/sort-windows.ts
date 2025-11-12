import type { Logger } from "@bluecadet/launchpad-utils/logger";
import chalk from "chalk";
import { windowManager } from "node-window-manager";
import semver from "semver";
import type { ResolvedAppConfig } from "../monitor-config.js";

type SortApp = {
	options: ResolvedAppConfig;
	pid?: number;
};

/**
 * The minimum major node version to support window ordering. Node versions < 17 seem to have a fatal
 * bug with the native API, which will intermittently cause V8 to crash hard. Defaults to '>=17.4.0'.
 */
export const MIN_NODE_VERSION = ">=17.4.0";

const sortWindows = async (apps: SortApp[], logger: Logger): Promise<void> => {
	const currNodeVersion = process.version;
	if (!semver.satisfies(currNodeVersion, MIN_NODE_VERSION)) {
		return Promise.reject(
			new Error(
				`Can't sort windows because the current node version '${currNodeVersion}' doesn't satisfy the required version '${MIN_NODE_VERSION}'. Please upgrade node to apply window settings like foreground/minimize/hide.`,
			),
		);
	}

	logger.debug(`Applying window settings to ${apps.length} ${apps.length === 1 ? "app" : "apps"}`);

	const fgPids = new Set();
	const minPids = new Set();
	const hidePids = new Set();

	windowManager.requestAccessibility();
	const visibleWindows = windowManager.getWindows().filter((win) => win.isVisible());
	const visiblePids = new Set(visibleWindows.map((win) => win.processId));

	for (const app of apps) {
		if (!app.pid) {
			logger.warn(
				`Can't sort windows for ${chalk.blue(app.options.pm2.name)} because it has no pid.`,
			);
			continue;
		}

		if (!visiblePids.has(app.pid)) {
			logger.warn(
				`No window found for ${chalk.blue(app.options.pm2.name)} with pid ${chalk.blue(app.pid)}.`,
			);
			continue;
		}

		if (app.options.windows.hide) {
			hidePids.add(app.pid);
		}
		if (app.options.windows.minimize) {
			minPids.add(app.pid);
		}
		if (app.options.windows.foreground) {
			fgPids.add(app.pid);
		}
	}

	for (const win of visibleWindows) {
		if (hidePids.has(win.processId)) {
			logger.info(`Hiding ${chalk.blue(win.getTitle())} (pid: ${chalk.blue(win.processId)})`);
			win.hide();
		}

		if (minPids.has(win.processId)) {
			logger.info(`Minimizing ${chalk.blue(win.getTitle())} (pid: ${chalk.blue(win.processId)})`);
			win.minimize();
		}
		if (fgPids.has(win.processId)) {
			logger.info(
				`Foregrounding ${chalk.blue(win.getTitle())} (pid: ${chalk.blue(win.processId)})`,
			);
			win.bringToTop();
		}
	}

	logger.debug("Done applying window settings.");
};

export default sortWindows;
