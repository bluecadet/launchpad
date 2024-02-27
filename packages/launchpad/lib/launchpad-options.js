/**
 * @module launchpad-options
 */

/**
 * @typedef {import("@bluecadet/launchpad-content/lib/content-plugin-driver").ContentHooks & import("@bluecadet/launchpad-monitor/lib/monitor-plugin-driver").MonitorHooks} AllHooks
 */

/**
 * @typedef LaunchpadOptions Combined options to initialize Launchpad.
 * @property {import("@bluecadet/launchpad-content").ContentOptions} [content]
 * @property {import("@bluecadet/launchpad-monitor").MonitorOptions} [monitor]
 * @property {import("./command-center").CommandOptions} [commands]
 * @property {import("./command-hooks").HookMapping} [hooks]
 * @property {import("@bluecadet/launchpad-utils/lib/plugin-driver").Plugin<AllHooks>[]} [plugins]
 * @property {import("@bluecadet/launchpad-utils/lib/log-manager").LogOptions} [logging]
 * @property {boolean} [shutdownOnExit] Will listen for exit events. Defaults to 'true'
 */

const LAUNCHPAD_OPTIONS_DEFAULTS = {
	shutdownOnExit: true
};

/**
 * Applies defaults to the provided launchpad config.
 * @param {LaunchpadOptions} config
 */
export function resolveLaunchpadOptions(config) {
	return {
		...LAUNCHPAD_OPTIONS_DEFAULTS,
		...config
	};
}

/**
 * @typedef {ReturnType<typeof resolveLaunchpadOptions>} ResolvedLaunchpadOptions
 */

/**
 * @param {LaunchpadOptions} config 
 * @returns {LaunchpadOptions}
 */
export function defineConfig(config) {
	return config;
}
