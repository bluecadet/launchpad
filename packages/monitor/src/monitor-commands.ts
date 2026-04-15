/**
 * Monitor plugin command types.
 * These commands are dispatched via the controller's executeCommand() method.
 */

import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";

const appNamesSchema = z.union([z.string(), z.array(z.string())]).optional();

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

export type MonitorCommandMap = {
	"monitor.connect": { input: MonitorConnectCommand; output: undefined };
	"monitor.disconnect": { input: MonitorDisconnectCommand; output: undefined };
	"monitor.start": { input: MonitorStartCommand; output: undefined };
	"monitor.stop": { input: MonitorStopCommand; output: undefined };
	"monitor.restart": { input: MonitorRestartCommand; output: undefined };
	"monitor.shutdown": { input: MonitorShutdownCommand; output: undefined };
};

export const monitorConnectCommandSchema = z
	.object({
		type: z.literal("monitor.connect"),
		ensureDaemonOwnership: z.boolean().optional(),
	})
	.strict();

export const monitorDisconnectCommandSchema = z
	.object({
		type: z.literal("monitor.disconnect"),
	})
	.strict();

export const monitorStartCommandSchema = z
	.object({
		type: z.literal("monitor.start"),
		appNames: appNamesSchema,
	})
	.strict();

export const monitorStopCommandSchema = z
	.object({
		type: z.literal("monitor.stop"),
		appNames: appNamesSchema,
	})
	.strict();

export const monitorRestartCommandSchema = z
	.object({
		type: z.literal("monitor.restart"),
		appNames: appNamesSchema,
	})
	.strict();

export const monitorShutdownCommandSchema = z
	.object({
		type: z.literal("monitor.shutdown"),
		exitCode: z.number().optional(),
	})
	.strict();

export const monitorCommandSchema = z.discriminatedUnion("type", [
	monitorConnectCommandSchema,
	monitorDisconnectCommandSchema,
	monitorStartCommandSchema,
	monitorStopCommandSchema,
	monitorRestartCommandSchema,
	monitorShutdownCommandSchema,
]);
