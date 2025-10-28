import type { LogConfig } from "./log-manager.js";

export {
	FixedConsoleLogger,
	NO_TTY,
	TTY_FIXED,
	TTY_FIXED_END,
	TTY_ONLY,
} from "./console-transport.js";
export type {
	BaseCommand,
	CommandExecutor,
	Disconnectable,
	EventBus,
	EventBusAware,
	LaunchpadEvents,
	StateProvider,
	Subsystem,
	SubsystemsState,
} from "./controller-interfaces.js";
export type { Logger } from "./log-manager.js";
export { LogManager, logConfigSchema } from "./log-manager.js";
export { onExit } from "./on-exit.js";
export type { BaseHookContext, HookSet, Plugin } from "./plugin-driver.js";
export {
	createPluginValidator,
	default as PluginDriver,
	HookContextProvider,
	PluginError,
} from "./plugin-driver.js";
export type { LogConfig };

// this will be augmented via declaration merging
export interface LaunchpadConfig {
	/**
	 * Logging configuration.
	 */
	logging?: LogConfig;
}
