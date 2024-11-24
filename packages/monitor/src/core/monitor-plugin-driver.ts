import {
	type BaseHookContext,
	HookContextProvider,
	type Logger,
	type Plugin,
	type PluginDriver,
} from "@bluecadet/launchpad-utils";
import { createPluginValidator } from "@bluecadet/launchpad-utils";
import type pm2 from "pm2";
import type LaunchpadMonitor from "../launchpad-monitor.js";

type MonitorHookContext = {
	/**
	 * the monitor instance
	 */
	monitor: LaunchpadMonitor;
};

export type MonitorHookArgs = {
	/** called before connecting to PM2 */
	beforeConnect: undefined;
	/** called after successfully connecting to PM2 */
	afterConnect: undefined;
	/** called before disconnecting from PM2 */
	beforeDisconnect: undefined;
	/** called after disconnecting from PM2 */
	afterDisconnect: undefined;
	/** called before starting an app */
	beforeAppStart: { appName: string };
	/** called after an app is started */
	afterAppStart: { appName: string; process: pm2.ProcessDescription };
	/** called before stopping an app */
	beforeAppStop: { appName: string };
	/** called after an app is stopped */
	afterAppStop: { appName: string };
	/** called when an app encounters an error */
	onAppError: { appName: string; error: Error };
	/** called when an app outputs a log message */
	onAppLog: { appName: string; data: string };
	/** called when an app outputs an error log */
	onAppErrorLog: { appName: string; data: string };
	/** called before shutting down the monitor */
	beforeShutdown: { code?: number };
};

export type CombinedMonitorHookContext = BaseHookContext<MonitorHookArgs> & MonitorHookContext;

export type MonitorPlugin = Plugin<MonitorHookArgs, CombinedMonitorHookContext>;

export function defineMonitorPlugin(plugin: MonitorPlugin): MonitorPlugin {
	return plugin;
}

export const monitorPluginSchema = createPluginValidator<
	MonitorHookArgs,
	CombinedMonitorHookContext
>();

export class MonitorPluginDriver extends HookContextProvider<
	MonitorHookArgs,
	CombinedMonitorHookContext
> {
	/**
	 * @type {import('../launchpad-monitor.js').LaunchpadMonitor}
	 */
	#monitor;

	constructor(
		wrappee: PluginDriver<MonitorHookArgs, CombinedMonitorHookContext>,
		{ monitor, logger }: { monitor: LaunchpadMonitor; logger: Logger },
	) {
		super(wrappee, logger);
		this.#monitor = monitor;

		// Add event handler to BusManager
		this.#monitor._busManager.addEventHandler(this._handleBusEvent.bind(this));
	}

	override _getPluginContext(plugin: MonitorPlugin): CombinedMonitorHookContext {
		return {
			...this._getBaseHookContext(plugin),
			monitor: this.#monitor,
		};
	}

	// biome-ignore lint/suspicious/noExplicitAny: TODO: swap for unknown
	_handleBusEvent(eventType: string, eventData: any) {
		if (!eventData?.process?.name) return;

		const appName = eventData.process.name;

		// Handle process events
		if (eventType === "process:event") {
			if (eventData.event === "error" || eventData.event === "exception") {
				this.runHookParallel("onAppError", {
					appName,
					error: new Error(eventData.data || "Unknown error"),
				});
			}
		}

		// Handle log events
		if (eventType === "log:out") {
			this.runHookParallel("onAppLog", {
				appName,
				data: eventData.data?.toString() || "",
			});
		}

		if (eventType === "log:err") {
			this.runHookParallel("onAppErrorLog", {
				appName,
				data: eventData.data?.toString() || "",
			});
		}
	}
}
