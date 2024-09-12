/**
 * @module launchpad-options
 */

/**
 * @typedef LaunchpadOptions Combined options to initialize Launchpad.
 * @property {import("@bluecadet/launchpad-content").ContentOptions} [content]
 * @property {import("@bluecadet/launchpad-monitor").MonitorOptions} [monitor]
 * @property {import("./command-center.js").CommandOptions} [commands]
 * @property {import("./command-hooks.js").HookMapping} [hooks]
 * @property {import("@bluecadet/launchpad-utils/lib/log-manager.js").LogOptions} [logging]
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
