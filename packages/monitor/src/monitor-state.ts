/**
 * Monitor subsystem state.
 * This represents the current state of the monitor system.
 */

import { PatchedStateManager } from "@bluecadet/launchpad-utils/state-patcher";
// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";
import { errAsync, type ResultAsync } from "neverthrow";

export type MonitorAppStatus = "online" | "offline" | "errored";
export type MonitorAppAction = "starting" | "stopping" | "restarting";

type AppState = {
	status: MonitorAppStatus;
	action?: MonitorAppAction;
	name: string;
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

declare module "@bluecadet/launchpad-utils/types" {
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
					name: appName,
				};
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

	acquireAppActionLock(
		appNames: string[] | string | undefined,
		action: MonitorAppAction,
		cb: () => ResultAsync<void, Error>,
	): ResultAsync<void, Error> {
		let appNamesArray: string[];

		if (appNames === undefined || appNames === null) {
			appNamesArray = Object.keys(this.state.apps);
		} else if (typeof appNames === "string") {
			appNamesArray = [appNames];
		} else {
			appNamesArray = appNames;
		}

		for (const appName of appNamesArray) {
			const appState = this.state.apps[appName];
			if (appState?.action) {
				return errAsync(
					new Error(`Cannot perform action on app "${appName}" while it is ${appState.action}.`),
				);
			}
		}

		// update action state with one atomic update
		this.updateState((state) => {
			for (const appName of appNamesArray) {
				const appState = state.apps[appName];
				if (appState) {
					appState.action = action;
				}
			}
		});

		return cb()
			.andTee(() => {
				// clear action state with one atomic update
				this.updateState((state) => {
					for (const appName of appNamesArray) {
						const appState = state.apps[appName];
						if (appState) {
							appState.action = undefined;
						}
					}
				});
			})
			.orTee((_error) => {
				// clear action state with one atomic update
				this.updateState((state) => {
					for (const appName of appNamesArray) {
						const appState = state.apps[appName];
						if (appState) {
							appState.action = undefined;
						}
					}
				});
			});
	}
}
