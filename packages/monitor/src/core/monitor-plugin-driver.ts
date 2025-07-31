import {
	type BaseHookContext,
	createPluginValidator,
	HookContextProvider,
	type Plugin,
	type PluginDriver,
} from "@bluecadet/launchpad-utils";
import type pm2 from "pm2";
import type LaunchpadMonitor from "../launchpad-monitor.js";

type MonitorHookContext = {
	/**
	 * the monitor instance
	 */
	monitor: LaunchpadMonitor;
};

export type CombinedMonitorHookContext = BaseHookContext & MonitorHookContext;

export type MonitorHooks = {
	/** called before connecting to PM2 */
	beforeConnect: (ctx: CombinedMonitorHookContext) => Promise<void> | void;
	/** called after successfully connecting to PM2 */
	afterConnect: (ctx: CombinedMonitorHookContext) => Promise<void> | void;
	/** called before disconnecting from PM2 */
	beforeDisconnect: (ctx: CombinedMonitorHookContext) => Promise<void> | void;
	/** called after disconnecting from PM2 */
	afterDisconnect: (ctx: CombinedMonitorHookContext) => Promise<void> | void;
	/** called before starting an app */
	beforeAppStart: (
		ctx: CombinedMonitorHookContext,
		arg: { appName: string },
	) => Promise<void> | void;
	/** called after an app is started */
	afterAppStart: (
		ctx: CombinedMonitorHookContext,
		arg: { appName: string; process: pm2.ProcessDescription },
	) => Promise<void> | void;
	/** called before stopping an app */
	beforeAppStop: (
		ctx: CombinedMonitorHookContext,
		arg: { appName: string },
	) => Promise<void> | void;
	/** called after an app is stopped */
	afterAppStop: (ctx: CombinedMonitorHookContext, arg: { appName: string }) => Promise<void> | void;
	/** called when an app encounters an error */
	onAppError: (
		ctx: CombinedMonitorHookContext,
		arg: { appName: string; error: Error },
	) => Promise<void> | void;
	/** called when an app outputs a log message */
	onAppLog: (
		ctx: CombinedMonitorHookContext,
		arg: { appName: string; data: string },
	) => Promise<void> | void;
	/** called when an app outputs an error log */
	onAppErrorLog: (
		ctx: CombinedMonitorHookContext,
		arg: { appName: string; data: string },
	) => Promise<void> | void;
	/** called before shutting down the monitor */
	beforeShutdown: (ctx: CombinedMonitorHookContext, arg: { code?: number }) => Promise<void> | void;
};

export type MonitorPlugin<T extends Partial<MonitorHooks> = Partial<MonitorHooks>> = Plugin<
	MonitorHooks,
	T
>;

export function defineMonitorPlugin<T extends Partial<MonitorHooks>>(
	plugin: MonitorPlugin<T>,
): MonitorPlugin<T> {
	return plugin;
}

export const monitorPluginSchema = createPluginValidator<MonitorHooks>([
	"beforeConnect",
	"afterConnect",
	"beforeDisconnect",
	"afterDisconnect",
	"beforeAppStart",
	"afterAppStart",
	"beforeAppStop",
	"afterAppStop",
	"onAppError",
	"onAppLog",
	"onAppErrorLog",
	"beforeShutdown",
]);

export class MonitorPluginDriver extends HookContextProvider<MonitorHooks, MonitorHookContext> {
	/**
	 * @type {import('../launchpad-monitor.js').LaunchpadMonitor}
	 */
	#monitor;

	constructor(wrappee: PluginDriver<MonitorHooks>, { monitor }: { monitor: LaunchpadMonitor }) {
		super(wrappee);
		this.#monitor = monitor;

		// Add event handler to BusManager
		this.#monitor._busManager.addEventHandler(this._handleBusEvent.bind(this));
	}

	override _getPluginContext() {
		return {
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
