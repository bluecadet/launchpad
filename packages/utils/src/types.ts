/**
 * File for types that are augmented by subsystems via declaration merging.
 */

import type { LogEventPayload } from "./logger.js";

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface LaunchpadConfig {}

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
export interface SubsystemsState {}

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface LaunchpadCommands {}

/**
 * Helper type to extract a command with its type field from LaunchpadCommands.
 * This converts the command registry format into a proper command object.
 *
 * @example
 * // If LaunchpadCommands has: { "content.fetch": { sources?: string[] } }
 * // Then Command<"content.fetch"> = { type: "content.fetch"; sources?: string[] }
 */
export type Command<T extends keyof LaunchpadCommands> = LaunchpadCommands[T] extends Record<
	string,
	never
>
	? { type: T }
	: { type: T } & LaunchpadCommands[T];

/**
 * Union of all registered commands.
 * This type automatically includes all commands from all subsystems via declaration merging.
 */
export type AnyCommand = {
	[K in keyof LaunchpadCommands]: Command<K>;
}[keyof LaunchpadCommands];

/**
 * System-level state (controller-owned)
 */
export type SystemState = {
	startTime: Date;
	version: string;
	mode: "task" | "persistent";
	[key: string]: unknown;
};

/**
 * Complete Launchpad state structure.
 * This is an aggregation of controller state + subsystem states.
 */
export type LaunchpadState = {
	system: SystemState;
	subsystems: Partial<SubsystemsState>;
};

/**
 * Versioned state snapshot returned to clients.
 * Includes the state version number for detecting dropped patches.
 */
export type VersionedLaunchpadState = LaunchpadState & {
	/** Version number - incremented with each patch */
	_version: number;
};
