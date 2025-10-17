/**
 * Monitor subsystem command types.
 * These commands are dispatched via the controller's executeCommand() method.
 */

import type { BaseCommand } from "@bluecadet/launchpad-utils";

/**
 * Connect to PM2 daemon
 */
export type MonitorConnectCommand = BaseCommand & {
	type: "monitor.connect";
	ensureDaemonOwnership?: boolean; // Kill existing daemon if running
};

/**
 * Disconnect from PM2 daemon
 */
export type MonitorDisconnectCommand = BaseCommand & {
	type: "monitor.disconnect";
};

/**
 * Start one or more apps
 */
export type MonitorStartCommand = BaseCommand & {
	type: "monitor.start";
	appNames?: string | string[]; // If omitted, starts all apps
};

/**
 * Stop one or more apps
 */
export type MonitorStopCommand = BaseCommand & {
	type: "monitor.stop";
	appNames?: string | string[]; // If omitted, stops all apps
};

/**
 * Restart one or more apps
 */
export type MonitorRestartCommand = BaseCommand & {
	type: "monitor.restart";
	appNames?: string | string[]; // If omitted, restarts all apps
};

/**
 * Shutdown monitor and exit
 */
export type MonitorShutdownCommand = BaseCommand & {
	type: "monitor.shutdown";
	exitCode?: number;
};

/**
 * Union of all monitor command types
 */
export type MonitorCommand =
	| MonitorConnectCommand
	| MonitorDisconnectCommand
	| MonitorStartCommand
	| MonitorStopCommand
	| MonitorRestartCommand
	| MonitorShutdownCommand;
