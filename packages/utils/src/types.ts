/**
 * File for types that are augmented by plugins via declaration merging.
 */

import type { LogEventPayload } from "./logger.js";

/**
 * Base event map with core log events.
 * Plugins extend this via declaration merging (deprecated) or by defining
 * their own event types and composing them at the app level.
 */
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

/**
 * @deprecated Use explicit plugin state types instead of declaration merging.
 * This interface exists for backward compatibility.
 */
// biome-ignore lint/suspicious/noEmptyInterface: backward compat for declaration merging
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
export type LaunchpadState<TPlugins extends object = PluginsState> = {
	system: SystemState;
	plugins: Partial<TPlugins>;
};

/**
 * Versioned state snapshot returned to clients.
 * Includes the state version number for detecting dropped patches.
 */
export type VersionedLaunchpadState<TPlugins extends object = PluginsState> =
	LaunchpadState<TPlugins> & {
		/** Version number - incremented with each patch */
		_version: number;
	};

export type Tone = "ok" | "warn" | "error" | "neutral";

export type Row =
	| { type: "kv"; label: string; value: string; tone?: Tone }
	| { type: "list"; label: string; items: Row[] }
	| { type: "text"; text: string; tone?: Tone };

export type Section = {
	/** Plugin name; used as a stable key. */
	name: string;
	/** Sort key; lower first; defaults to 50. */
	order?: number;
	/** Section heading, e.g. "Content". */
	title: string;
	rows: Row[];
};

export type StatusSnapshot = {
	header: {
		/** ISO timestamp string. */
		startTime: string;
		uptimeMs: number;
		mode: SystemState["mode"];
	};
	/** Already sorted and non-null. */
	sections: Section[];
};
