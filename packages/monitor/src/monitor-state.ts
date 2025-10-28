/**
 * Monitor subsystem state.
 * This represents the current state of the monitor system.
 */

import { PatchedStateManager } from "@bluecadet/launchpad-utils";

export type MonitorAppStatus = "online" | "offline" | "errored";

type AppState = {
	status: MonitorAppStatus;
	pid?: number;
	pm2Id?: number;
	lastStart?: Date;
	lastStop?: Date;
	lastError?: Date;
};

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
		[appName: string]: AppState;
	};
};

declare module "@bluecadet/launchpad-utils" {
	interface SubsystemsState {
		monitor: MonitorState;
	}
}

export class MonitorStateManager extends PatchedStateManager<MonitorState> {
	constructor() {
		super({
			isConnected: false,
			isShuttingDown: false,
			apps: {},
		});
	}

	setConnected(isConnected: boolean): void {
		this.updateState((draft) => {
			draft.isConnected = isConnected;
			const now = new Date();
			if (isConnected) {
				draft.lastConnect = now;
			} else {
				draft.lastDisconnect = now;
			}
		});
	}

	setShuttingDown(isShuttingDown: boolean): void {
		this.updateState((draft) => {
			draft.isShuttingDown = isShuttingDown;
		});
	}

	initializeApp(appName: string): void {
		this.updateState((draft) => {
			if (!draft.apps[appName]) {
				draft.apps[appName] = {
					status: "offline",
				};
			}
		});
	}

	updateAppStatus(appName: string, status: Partial<AppState>): void {
		this.updateState((draft) => {
			const app = draft.apps[appName];
			if (app) {
				Object.assign(app, status);
			}
		});
	}

	markAppStarted(appName: string, pid?: number, pm2Id?: number): void {
		this.updateState((draft) => {
			const app = draft.apps[appName];
			if (app) {
				app.status = "online";
				app.pid = pid;
				app.pm2Id = pm2Id;
				app.lastStart = new Date();
			}
		});
	}

	markAppStopped(appName: string): void {
		this.updateState((draft) => {
			const app = draft.apps[appName];
			if (app) {
				app.status = "offline";
				app.pid = undefined;
				app.pm2Id = undefined;
				app.lastStop = new Date();
			}
		});
	}

	markAppErrored(appName: string): void {
		this.updateState((draft) => {
			const app = draft.apps[appName];
			if (app) {
				app.status = "errored";
				app.lastError = new Date();
			}
		});
	}
}
