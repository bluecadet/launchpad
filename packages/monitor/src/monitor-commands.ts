/**
 * Monitor subsystem command types.
 * These commands are dispatched via the controller's executeCommand() method.
 */

import type { Command } from "@bluecadet/launchpad-utils/types";

// Declaration merging to add monitor commands to LaunchpadCommands
declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadCommands {
		/**
		 * Connect to PM2 daemon
		 */
		"monitor.connect": {
			/** Kill existing daemon if running */
			ensureDaemonOwnership?: boolean;
		};

		/**
		 * Disconnect from PM2 daemon
		 */
		"monitor.disconnect": Record<string, never>;

		/**
		 * Start one or more apps
		 */
		"monitor.start": {
			/** If omitted, starts all apps */
			appNames?: string | string[];
		};

		/**
		 * Stop one or more apps
		 */
		"monitor.stop": {
			/** If omitted, stops all apps */
			appNames?: string | string[];
		};

		/**
		 * Restart one or more apps
		 */
		"monitor.restart": {
			/** If omitted, restarts all apps */
			appNames?: string | string[];
		};

		/**
		 * Shutdown monitor and exit
		 */
		"monitor.shutdown": {
			exitCode?: number;
		};
	}
}
