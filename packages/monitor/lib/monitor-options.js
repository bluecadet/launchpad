import * as pm2 from 'pm2';

/**
 * @module monitor-options
 */

/**
 * Top-level options of Launchpad Monitor.
 */
export class MonitorOptions {
	constructor({
		apps = [],
		deleteExistingBeforeConnect = false,
		windowsApi = new WindowsApiOptions(),
		...rest
	} = {}) {
		/**
		 * A list of `AppOptions` to configure which apps to launch and monitor.
		 * @type {Array<AppOptions>}
		 * @default []
		 */
		this.apps = apps;
		
		/**
		 * Set this to true to delete existing PM2 processes before connecting. If you're running volatile apps or your node process might be quit unexpectedly, this can be helpful to start with a clean slate on startup.
		 * @type {boolean}
		 * @default false
		 */
		this.deleteExistingBeforeConnect = deleteExistingBeforeConnect;
		
		/**
		 * Advanced configuration for the Windows API, e.g. for managing foreground/minimized/hidden windows.
		 * @type {WindowsApiOptions} 
		 */
		this.windowsApi = new WindowsApiOptions(windowsApi);
		
		Object.assign(this, rest);
	}
};

/**
 * Options for an individual app to monitor.
 */
export class AppOptions {
	constructor({
		pm2 = null,
		windows = new WindowOptions(),
		logging = new AppLogOptions(),
	} = {}) {
		/**
		 * Configure which app to launch and how to monitor it here.
		 * @see https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available
		 * @type {pm2.StartOptions}
		 * @default null
		 */
		this.pm2 = pm2;
		/**
		 * Optional settings for moving this app's main windows to the foreground, minimize or hide them.
		 * @type {WindowOptions}
		 * @default new WindowOptions()
		 */
		this.windows = windows;
		/**
		 * Optional settings for how to log this app's output.
		 * @type {AppLogOptions}
		 * @default new AppLogOptions()
		 */
		this.logging = logging;
	}
}

/**
 * Options for how an app's windows should be managed.
 */
export class WindowOptions {
	constructor({
		foreground = false,
		minimize = false,
		hide = false
	} = {}) {
		/**
		 * Move this app to the foreground once all apps have been launched.
		 * @type {boolean}
		 * @default false
		 */
		this.foreground = foreground;
		/**
		 * Minimize this app's windows once all apps have been launched.
		 * @type {boolean}
		 * @default false
		 */
		this.minimize = minimize;
		/**
		 * Completely hide this app's windows once all apps have been launched. Helpful for headless apps, but note that this might cause issues with GUI-based apps.
		 * 
		 * @type {boolean}
		 * @default false
		 */
		this.hide = hide;
	}
}

/**
 * Available log modes for each app
 * @readonly
 * @enum {string}
 */
export const LogModes = {
	/**
	 * Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus.
	 * @type {string} 
	 */
	TailLogFile: 'file',
	/**
	 * Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app.
	 * @type {string}
	 */
	LogBusEvents: 'bus',
};

/**
 * Options for how an app's logs should be saved, routed and displayed.
 */
export class AppLogOptions {
	constructor({
		logToLaunchpadDir = true,
		mode = LogModes.TailLogFile,
		showStdout = true,
		showStderr = true,
	} = {}) {
		/**
		 * Route application logs to launchpad's log dir instead of pm2's log dir.
		 * @type {boolean}
		 * @default true
		 */
		this.logToLaunchpadDir = logToLaunchpadDir;
		/**
		 * How to grab the app's logs. Supported values:
		 * - `'file'`: Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus.
		 * - `'bus'`: Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app.
		 * @type {string}
		 * @default 'file'
		 */
		this.mode = mode;
		/**
		 * Whether or not to include output from `stdout`
		 * @type {boolean}
		 * @default true
		 */
		this.showStdout = showStdout;
		/**
		 * Whether or not to include output from `stderr`
		 * @type {boolean}
		 * @default true
		 */
		this.showStderr = showStderr;
	}
}

/**
 * Global options for how window order should be managed.
 */
export class WindowsApiOptions {
	constructor({
		nodeVersion = '>=17.4.0',
		debounceDelay = 3000,
		fakeKey = 'control',
		...rest
	} = {}) {
		/**
		 * The minimum major node version to support window ordering.
		 * Node versions < 17 seem to have a fatal bug with the native
		 * API, which will intermittently cause V8 to crash hard.
		 * @see https://github.com/node-ffi-napi/ref-napi/issues/54#issuecomment-1029639256
		 * @type {string}
		 * @default '>=17.4.0'
		 */
		this.nodeVersion = nodeVersion;
		/**
		 * The delay until windows are ordered after launch of in ms.
		 * 
		 * If your app takes a long time to open all of its windows, set this number to a higher value to ensure it can be on top of the launchpad terminal window.
		 * 
		 * Keeping this high also reduces the CPU load if apps relaunch often.
		 * @type {number}
		 * @default 3000
		 */
		this.debounceDelay = debounceDelay;
		/**
		 * Windows OS is very strict with when and how apps can move windows to the foreground or backgruond. As a workaround, Launchpad emulates a keypress to make the current process active.
		 * 
		 * This setting configures which key is used to emulate in order to gain control over window foregrounding/backgrounding. This key gets emulated after an app launches or re-launches.
		 * 
		 * @see https://robotjs.io/docs/syntax#keys for available options
		 * @see https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow#remarks for window management requirements
		 * @type {string}
		 * @default 'control'
		 */
		this.fakeKey = fakeKey;
		
		Object.assign(this, rest);
	}
}