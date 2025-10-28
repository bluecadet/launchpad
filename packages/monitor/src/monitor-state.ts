/**
 * Monitor subsystem state.
 * This represents the current state of the monitor system.
 */

export type MonitorAppStatus = "online" | "offline" | "errored";

export type MonitorState = {
	/** Whether connected to PM2 daemon */
	isConnected: boolean;
	/** Whether currently shutting down */
	isShuttingDown: boolean;
	/** Timestamp of last connect */
	lastConnect?: Date;
	/** Timestamp of last disconnect */
	lastDisconnect?: Date;
	/** Configured apps */
	apps: {
		[appName: string]: {
			status: MonitorAppStatus;
			pid?: number;
			pm2Id?: number;
			lastStart?: Date;
			lastStop?: Date;
			lastError?: Date;
		};
	};
};

declare module "@bluecadet/launchpad-utils" {
	interface SubsystemsState {
		monitor: MonitorState;
	}
}
