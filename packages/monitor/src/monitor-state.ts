/**
 * Monitor subsystem state.
 * This represents the current state of the monitor system.
 */

export type MonitorState = {
	/** Whether connected to PM2 daemon */
	isConnected: boolean;
	/** Whether currently shutting down */
	isShuttingDown: boolean;
	/** Total number of apps configured */
	totalApps: number;
	/** Names of all configured apps */
	appNames: string[];
	/** Timestamp of last connect */
	lastConnect?: Date;
	/** Timestamp of last disconnect */
	lastDisconnect?: Date;
};
