/**
 * @module monitor-options
 */

/**
 * Base options for LaunchpadMonitor
 */
export class MonitorOptions {
	constructor({
		apps = [],
		deleteExistingBeforeConnect = false,
		windowsApi = new WindowsApiOptions(),
		...rest
	} = {}) {
		/**
		 * @type {Array<AppOptions>}
		 */
		this.apps = apps;
		
		/**
		 * Set this to true to delete existing PM2 processes before connecting.
		 * @type {boolean}
		 */
		this.deleteExistingBeforeConnect = deleteExistingBeforeConnect;
		
		/**
		 * Settings specific to using the Windows API for things like setting
		 * foreground/minimized/hidden windows.
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
		windows = new WindowOptions().
		logging = new AppLogOptions(),
	} = {}) {
		/** @type {pm2.StartOptions} */
		this.pm2 = pm2;
		/** @type {WindowOptions} */
		this.windows = windows;
		/** @type {AppLogOptions} */
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
		/** @type {boolean} */
		this.foreground = foreground;
		/** @type {boolean} */
		this.minimize = minimize;
		/** @type {boolean} */
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
		this.logToLaunchpadDir = logToLaunchpadDir;
		this.mode = mode;
		this.showStdout = showStdout;
		this.showStderr = showStderr;
	}
}

/**
 * General options for all Windows API logic.
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
		 * 
		 * Defaults to '>=17.4.0'. For more info, see
		 * https://github.com/node-ffi-napi/ref-napi/issues/54#issuecomment-1029639256
		 * 
		 * @type {string}
		 */
		this.nodeVersion = nodeVersion;
		/**
		 * The delay until windows are ordered after launch of in ms.
		 * Keeping this high reduces the CPU load if apps relaunch often.
		 * @type {number}
		 */
		this.debounceDelay = debounceDelay;
		/**
		 * The key tap to emulate in order to gain control over
		 * window foregrounding/backgrounding. This key gets
		 * emulated after an app launches or re-launches.
		 * 
		 * @see https://robotjs.io/docs/syntax#keys 
		 * @type {string}
		 */
		this.fakeKey = fakeKey;
		
		Object.assign(this, rest);
	}
}