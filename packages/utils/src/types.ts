import type { LogConfig } from "./log-manager.js";

// this will be augmented via declaration merging
export interface LaunchpadConfig {
	/**
	 * Logging configuration.
	 */
	logging?: LogConfig;
}

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface LaunchpadEvents {}

// biome-ignore lint/suspicious/noEmptyInterface: this will be augmented via declaration merging
export interface SubsystemsState {}
