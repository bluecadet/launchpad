import * as pm2 from 'pm2';

/**
 * @module monitor-options
 */

/**
 * @typedef WindowsApiConfig Global options for how window order should be managed.
 * @property {number} [debounceDelay] The delay until windows are ordered after launch of in ms. Defaults to 3000. If your app takes a long time to open all of its windows, set this number to a higher value to ensure it can be on top of the launchpad terminal window. Keeping this high also reduces the CPU load if apps relaunch often. see https://github.com/node-ffi-napi/ref-napi/issues/54#issuecomment-1029639256
 * @property {string} [nodeVersion] The minimum major node version to support window ordering. Node versions < 17 seem to have a fatal bug with the native API, which will intermittently cause V8 to crash hard. Defaults to '>=17.4.0'.
 */

const WINDOWS_API_DEFAULTS = {
	debounceDelay: 3000,
	nodeVersion: '>=17.4.0'
};

/**
 * @typedef WindowConfig Options for how an app's windows should be managed.
 * @property {boolean} [foreground] Move this app to the foreground once all apps have been launched. Defaults to false.
 * @property {boolean} [minimize] Minimize this app's windows once all apps have been launched. Defaults to false.
 * @property {boolean} [hide] Completely hide this app's windows once all apps have been launched. Helpful for headless apps, but note that this might cause issues with GUI-based apps. Defaults to false.
 */

const WINDOW_CONFIG_DEFAULTS = {
	foreground: false,
	minimize: false,
	hide: false
};

/**
 * Available log modes for each app
 * @readonly
 * @enum {'file' | 'bus'}
 */
export const LogModes = {
	/**
	 * Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad.
	 * @type {'file'}
	 */
	TailLogFile: 'file',
	
	/**
	 * Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app.
	 * @type {'bus'}
	 */
	LogBusEvents: 'bus'
};

/**
 * @typedef AppLogConfig Options for how an app's logs should be saved, routed and displayed.
 * @property {boolean} [logToLaunchpadDir] Route application logs to launchpad's log dir instead of pm2's log dir. Defaults to true.
 * @property {LogModes} [mode] How to grab the app's logs. Supported values: - 'bus': Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app. - 'file': Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad. Defaults to 'bus'.
 * @property {boolean} [showStdout] Whether or not to include output from `stdout`
 * @property {boolean} [showStderr] Whether or not to include output from `stderr`
 */

const APP_LOG_CONFIG_DEFAULTS = {
	logToLaunchpadDir: true,
	mode: LogModes.LogBusEvents,
	showStdout: true,
	showStderr: true
};

/**
 * @typedef AppConfig Options for an individual app to monitor.
 * @property {pm2.StartOptions & {out_file?: string, error_file?: string}} pm2 Configure which app to launch and how to monitor it here. see https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available
 * @property {WindowConfig} [windows] Optional settings for moving this app's main windows to the foreground, minimize or hide them.
 * @property {AppLogConfig} [logging] Optional settings for how to log this app's output.
 */

const APP_CONFIG_DEFAULTS = {
	windows: WINDOW_CONFIG_DEFAULTS,
	logging: APP_LOG_CONFIG_DEFAULTS
};

/**
 * @typedef MonitorConfig Top-level options of Launchpad Monitor.
 * @property {Array<AppConfig>} [apps] A list of `AppOptions` to configure which apps to launch and monitor.
 * @property {boolean} [deleteExistingBeforeConnect] Set this to true to delete existing PM2 processes before connecting. If you're running volatile apps or your node process might be quit unexpectedly, this can be helpful to start with a clean slate on startup.
 * @property {WindowsApiConfig} [windowsApi] Advanced configuration for the Windows API, e.g. for managing foreground/minimized/hidden windows.
 * @property {import('./core/monitor-plugin-driver.js').MonitorPlugin[]} [plugins] A list of plugins.
 * @property {boolean} [shutdownOnExit] Will listen for exit events. Defaults to 'true'.
 */

export const MONITOR_CONFIG_DEFAULTS = {
	apps: [],
	deleteExistingBeforeConnect: false,
	windowsApi: WINDOWS_API_DEFAULTS,
	plugins: [],
	shutdownOnExit: true
};

/**
 * 
 * @param {MonitorConfig} [config] 
 * @returns 
 */
export function resolveMonitorConfig(config) {
	return {
		...MONITOR_CONFIG_DEFAULTS,
		...config,
		windowsApi: {
			...WINDOWS_API_DEFAULTS,
			...config?.windowsApi ?? {}
		},
		apps: config?.apps?.map(app => ({
			...APP_CONFIG_DEFAULTS,
			...app,
			windows: {
				...WINDOW_CONFIG_DEFAULTS,
				...app.windows ?? {}
			},
			logging: {
				...APP_LOG_CONFIG_DEFAULTS,
				...app.logging ?? {}
			}
		})) ?? []
	};
}

/**
 * @typedef {ReturnType<typeof resolveMonitorConfig>} ResolvedMonitorConfig
 */

/**
 * @typedef {ResolvedMonitorConfig['apps'][number]} ResolvedAppConfig
 */

/**
 * @param {MonitorConfig} config 
 * @returns {MonitorConfig}
 */
export function defineMonitorConfig(config) {
	return config;
}
