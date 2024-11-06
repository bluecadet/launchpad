import type pm2 from "pm2";
import type { MonitorPlugin } from "./core/monitor-plugin-driver.js";

/**
 * Global options for how window order should be managed.
 */
export type WindowsApiConfig = {
	/**
	 * The delay until windows are ordered after launch of in ms. Defaults to 3000. If your app takes a long time to open all of its windows, set this number to a higher value to ensure it can be on top of the launchpad terminal window. Keeping this high also reduces the CPU load if apps relaunch often. see https://github.com/node-ffi-napi/ref-napi/issues/54#issuecomment-1029639256
	 */
	debounceDelay?: number;
	/**
	 * The minimum major node version to support window ordering. Node versions < 17 seem to have a fatal bug with the native API, which will intermittently cause V8 to crash hard. Defaults to '>=17.4.0'.
	 */
	nodeVersion?: string;
};

const WINDOWS_API_DEFAULTS = {
	debounceDelay: 3000,
	nodeVersion: ">=17.4.0",
} satisfies Partial<WindowsApiConfig>;

/**
 * Options for how an app's windows should be managed.
 */
export type WindowConfig = {
	/**
	 * Move this app to the foreground once all apps have been launched. Defaults to false.
	 */
	foreground?: boolean;
	/**
	 * Minimize this app's windows once all apps have been launched. Defaults to false.
	 */
	minimize?: boolean;
	/**
	 * Completely hide this app's windows once all apps have been launched. Helpful for headless apps, but note that this might cause issues with GUI-based apps. Defaults to false.
	 */
	hide?: boolean;
};

const WINDOW_CONFIG_DEFAULTS = {
	foreground: false,
	minimize: false,
	hide: false,
} satisfies Partial<WindowConfig>;

/**
 * Available log modes for each app
 */
export enum LogModes {
	/**
	 * Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad.
	 */
	TailLogFile = "file",
	/**
	 * Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app.
	 */
	LogBusEvents = "bus",
}

/**
 * Options for how an app's logs should be saved, routed and displayed.
 */
export type AppLogConfig = {
	/**
	 * Route application logs to launchpad's log dir instead of pm2's log dir. Defaults to true.
	 */
	logToLaunchpadDir?: boolean;
	/**
	 * How to grab the app's logs. Supported values: - 'bus': Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app. - 'file': Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad. Defaults to 'bus'.
	 */
	mode?: LogModes;
	/**
	 * Whether or not to include output from `stdout`. Defaults to true.
	 */
	showStdout?: boolean;
	/**
	 * Whether or not to include output from `stderr`. Defaults to true.
	 */
	showStderr?: boolean;
};

const APP_LOG_CONFIG_DEFAULTS = {
	logToLaunchpadDir: true,
	mode: LogModes.LogBusEvents,
	showStdout: true,
	showStderr: true,
} satisfies Partial<AppLogConfig>;

/**
 * Options for an individual app to monitor.
 */
export type AppConfig = {
	/**
	 * pm2 configuration for this app. see https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available
	 */
	pm2: pm2.StartOptions & { out_file?: string; error_file?: string };
	/**
	 * Optional settings for moving this app's main windows to the foreground, minimize or hide them.
	 */
	windows?: WindowConfig;
	/**
	 * Optional settings for how to log this app's output.
	 */
	logging?: AppLogConfig;
};

const APP_CONFIG_DEFAULTS = {
	windows: WINDOW_CONFIG_DEFAULTS,
	logging: APP_LOG_CONFIG_DEFAULTS,
} satisfies Partial<AppConfig>;

/**
 * Top-level options of Launchpad Monitor.
 */
export type MonitorConfig = {
	/**
	 * A list of apps to launch and monitor.
	 */
	apps?: AppConfig[];
	/**
	 * Set this to true to delete existing PM2 processes before connecting. If you're running volatile apps or your node process might be quit unexpectedly, this can be helpful to start with a clean slate on startup.
	 */
	deleteExistingBeforeConnect?: boolean;
	/**
	 * Advanced configuration for the Windows API, e.g. for managing foreground/minimized/hidden windows.
	 */
	windowsApi?: WindowsApiConfig;
	/**
	 * A list of plugins.
	 */
	plugins?: MonitorPlugin[];
	/**
	 * Will listen for exit events. Defaults to true.
	 */
	shutdownOnExit?: boolean;
};

export const MONITOR_CONFIG_DEFAULTS = {
	apps: [],
	deleteExistingBeforeConnect: false,
	windowsApi: WINDOWS_API_DEFAULTS,
	plugins: [],
	shutdownOnExit: true,
} satisfies Partial<MonitorConfig>;

export function resolveMonitorConfig(config: MonitorConfig) {
	return {
		...MONITOR_CONFIG_DEFAULTS,
		...config,
		windowsApi: {
			...WINDOWS_API_DEFAULTS,
			...(config?.windowsApi ?? {}),
		},
		apps:
			config?.apps?.map((app) => ({
				...APP_CONFIG_DEFAULTS,
				...app,
				windows: {
					...WINDOW_CONFIG_DEFAULTS,
					...(app.windows ?? {}),
				},
				logging: {
					...APP_LOG_CONFIG_DEFAULTS,
					...(app.logging ?? {}),
				},
			})) ?? [],
	};
}

export type ResolvedMonitorConfig = ReturnType<typeof resolveMonitorConfig>;

export type ResolvedAppConfig = ResolvedMonitorConfig["apps"][number];

export function defineMonitorConfig(config: MonitorConfig) {
	return config;
}
