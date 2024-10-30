/**
 * @module launchpad-options
 */

/**
 * @typedef LaunchpadOptions Combined options to initialize Launchpad.
 * @property {import("@bluecadet/launchpad-content").ContentOptions} [content]
 * @property {import("@bluecadet/launchpad-monitor").MonitorOptions} [monitor]
 * @property {import("@bluecadet/launchpad-utils/lib/log-manager.js").LogOptions} [logging]
 */

/**
 * Applies defaults to the provided launchpad config.
 * @param {LaunchpadOptions} config
 */
export function resolveLaunchpadOptions(config) {
	// NOTE: at the moment, there are no defaults to apply
	// so this function is just a passthrough
	return config;
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
