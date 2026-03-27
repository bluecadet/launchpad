/**
 * File for types that are augmented by plugins via declaration merging.
 */

import type { LogEventPayload } from "./logger.js";

export interface LaunchpadEvents {
	"log:error": LogEventPayload;
	"log:warn": LogEventPayload;
	"log:info": LogEventPayload;
	"log:debug": LogEventPayload;
	"log:verbose": LogEventPayload;
	/**
	 * Event for updating TTY fixed console messages.
	 * Payload contains the message to display (including any ANSI codes).
	 */
	"log:tty": {
		message: string | null;
	};
	/**
	 * Event for closing TTY fixed console messages.
	 * No payload.
	 */
	"log:tty:close": {
		// no payload
		[k: string]: never;
	};
	// other events can be added via declaration merging
}

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface PluginsState {}

/**
 * System-level state (controller-owned)
 */
export type SystemState = {
	startTime: Date;
	mode: "task" | "persistent";
	[key: string]: unknown;
};

/**
 * Complete Launchpad state structure.
 * This is an aggregation of controller state + plugin states.
 */
export type LaunchpadState = {
	system: SystemState;
	plugins: Partial<PluginsState>;
};

/**
 * Versioned state snapshot returned to clients.
 * Includes the state version number for detecting dropped patches.
 */
export type VersionedLaunchpadState = LaunchpadState & {
	/** Version number - incremented with each patch */
	_version: number;
};
