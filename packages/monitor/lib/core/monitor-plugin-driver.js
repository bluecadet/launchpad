import { HookContextProvider } from '@bluecadet/launchpad-utils/lib/plugin-driver.js';

/**
 * @typedef MonitorHookContext
 * @property {import('../launchpad-monitor.js').LaunchpadMonitor} monitor The monitor instance
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').BaseHookContext & MonitorHookContext} CombinedMonitorHookContext
 */

/**
 * @typedef MonitorHooks
 * @property {(ctx: CombinedMonitorHookContext) => Promise<void> | void} beforeConnect Called before connecting to PM2
 * @property {(ctx: CombinedMonitorHookContext) => Promise<void> | void} afterConnect Called after successfully connecting to PM2
 * @property {(ctx: CombinedMonitorHookContext) => Promise<void> | void} beforeDisconnect Called before disconnecting from PM2
 * @property {(ctx: CombinedMonitorHookContext) => Promise<void> | void} afterDisconnect Called after disconnecting from PM2
 * @property {(ctx: CombinedMonitorHookContext, arg: {appName: string}) => Promise<void> | void} beforeAppStart Called before starting an app
 * @property {(ctx: CombinedMonitorHookContext, arg: {appName: string, process: import('pm2').ProcessDescription}) => Promise<void> | void} afterAppStart Called after an app is started
 * @property {(ctx: CombinedMonitorHookContext, arg: {appName: string}) => Promise<void> | void} beforeAppStop Called before stopping an app
 * @property {(ctx: CombinedMonitorHookContext, arg: {appName: string}) => Promise<void> | void} afterAppStop Called after an app is stopped
 * @property {(ctx: CombinedMonitorHookContext, arg: {appName: string, error: Error}) => Promise<void> | void} onAppError Called when an app encounters an error
 * @property {(ctx: CombinedMonitorHookContext, arg: {appName: string, data: string}) => Promise<void> | void} onAppLog Called when an app outputs a log message
 * @property {(ctx: CombinedMonitorHookContext, arg: {appName: string, data: string}) => Promise<void> | void} onAppErrorLog Called when an app outputs an error log
 * @property {(ctx: CombinedMonitorHookContext, arg: {code?: number}) => Promise<void> | void} beforeShutdown Called before monitor shutdown
 */

/**
 * @typedef {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').Plugin<MonitorHooks>} MonitorPlugin
 */

/**
 * @extends {HookContextProvider<MonitorHooks, MonitorHookContext>}
 */
export class MonitorPluginDriver extends HookContextProvider {
	/**
	 * @type {import('../launchpad-monitor.js').LaunchpadMonitor}
	 */
	#monitor;

	/**
	 * @param {import('@bluecadet/launchpad-utils/lib/plugin-driver.js').default<MonitorHooks>} wrappee
	 * @param {object} options
	 * @param {import('../launchpad-monitor.js').LaunchpadMonitor} options.monitor
	 */
	constructor(wrappee, { monitor }) {
		super(wrappee);
		this.#monitor = monitor;

		// Add event handler to BusManager
		this.#monitor._busManager.addEventHandler(this._handleBusEvent.bind(this));
	}

	/**
	 * @override
	 */
	_getPluginContext() {
		return {
			monitor: this.#monitor
		};
	}

	/**
	 * @param {string} eventType
	 * @param {*} eventData
	 */
	_handleBusEvent(eventType, eventData) {
		if (!eventData?.process?.name) return;

		const appName = eventData.process.name;

		// Handle process events
		if (eventType === 'process:event') {
			if (eventData.event === 'error' || eventData.event === 'exception') {
				this.runHookParallel('onAppError', {
					appName,
					error: new Error(eventData.data || 'Unknown error')
				});
			}
		}

		// Handle log events
		if (eventType === 'log:out') {
			this.runHookParallel('onAppLog', {
				appName,
				data: eventData.data?.toString() || ''
			});
		}

		if (eventType === 'log:err') {
			this.runHookParallel('onAppErrorLog', {
				appName,
				data: eventData.data?.toString() || ''
			});
		}
	}
}
