import semver from 'semver';
import chalk from 'chalk';
import { windowManager } from 'node-window-manager';
import { Logger } from '@bluecadet/launchpad-utils';
import { AppOptions } from '../monitor-options.js';

export class SortApp {
	/**
	 * @type {AppOptions}
	 */
	options = null;
	/**
	 * @type {number}
	 */
	pid = null;
}

/**
 * 
 * @param {Array.<SortApp>} apps 
 * @param {Logger} logger
 * @param {string} minNodeVersion
 * @returns {Promise}
 */
const sortWindows = async (apps, logger = console, minNodeVersion = undefined) => {
	const currNodeVersion = process.version;
	if (!semver.satisfies(currNodeVersion, minNodeVersion)) {
		return Promise.reject(`Can't sort windows because the current node version '${currNodeVersion}' doesn't satisfy the required version '${minNodeVersion}'. Please upgrade node to apply window settings like foreground/minimize/hide.`);
	}
	
	logger.debug(`Applying window settings to ${apps.length} ${apps.length === 1 ? 'app' : 'apps'}`);

	const fgPids = new Set();
	const minPids = new Set();
	const hidePids = new Set();
	
	windowManager.requestAccessibility();
	const visibleWindows = windowManager.getWindows().filter(win => win.isVisible());
	const visiblePids = new Set(visibleWindows.map(win => win.processId));
	
	for (const app of apps) {
		if (!visiblePids.has(app.pid)) {
			logger.warn(`No window found for ${chalk.blue(app.options.pm2.name)} with pid ${chalk.blue(app.pid)}.`);
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
	
	visibleWindows.filter(win => hidePids.has(win.processId)).forEach(win => {
		logger.info(`Hiding ${chalk.blue(win.getTitle())} (pid: ${chalk.blue(win.processId)})`);
		win.hide();
	});
	visibleWindows.filter(win => minPids.has(win.processId)).forEach(win => {
		logger.info(`Minimizing ${chalk.blue(win.getTitle())} (pid: ${chalk.blue(win.processId)})`);
		win.minimize();
	});
	visibleWindows.filter(win => fgPids.has(win.processId)).forEach(win => {
		logger.info(`Foregrounding ${chalk.blue(win.getTitle())} (pid: ${chalk.blue(win.processId)})`);
		win.bringToTop();
	});
	
	logger.debug(`Done applying window settings.`);
};

export default sortWindows;