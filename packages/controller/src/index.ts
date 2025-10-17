// Main controller class

export { CommandDispatcher } from "./core/command-dispatcher.js";

// Core types
export type { Command, CommandType } from "./core/commands.js";
export type {
	ControllerConfig,
	ControllerMode,
} from "./core/controller-config.js";
export { controllerConfigSchema } from "./core/controller-config.js";
export type { LaunchpadEvents } from "./core/event-bus.js";
// Core classes (for advanced usage)
export { EventBus } from "./core/event-bus.js";
export type {
	LaunchpadState,
	SystemState,
} from "./core/state-store.js";
export { StateStore } from "./core/state-store.js";
export { LaunchpadController } from "./launchpad-controller.js";
