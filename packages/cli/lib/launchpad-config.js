/**
 * @typedef LaunchpadConfig Combined options to initialize Launchpad.
 * @property {import("@bluecadet/launchpad-content").ContentConfig} [content]
 * @property {import("@bluecadet/launchpad-monitor").MonitorConfig} [monitor]
 * @property {import("@bluecadet/launchpad-utils/lib/log-manager.js").LogConfig} [logging]
 */

/**
 * Applies defaults to the provided launchpad config.
 * @param {LaunchpadConfig} config
 */
export function resolveLaunchpadConfig(config) {
	// NOTE: at the moment, there are no defaults to apply
	// so this function is just a passthrough
	return config;
}

/**
 * @typedef {ReturnType<typeof resolveLaunchpadConfig>} ResolvedLaunchpadOptions
 */

/**
 * @param {LaunchpadConfig} config 
 * @returns {LaunchpadConfig}
 */
export function defineConfig(config) {
	return config;
}
