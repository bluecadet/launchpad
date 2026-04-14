/**
 * Dashboard plugin state.
 */

// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

export type DashboardState = {
	/** Whether the HTTP server is currently running */
	isRunning: boolean;
	/** Port the server is listening on */
	port: number;
	/** Host the server is bound to */
	host: string;
	/** ISO timestamp when the server last started */
	startedAt?: string;
};

declare module "@bluecadet/launchpad-utils/types" {
	interface PluginsState {
		dashboard: DashboardState;
	}
}

export class DashboardStateManager {
	constructor(
		private readonly updateState: (producer: (draft: DashboardState) => void) => void,
		port: number,
		host: string,
	) {
		this.updateState((draft) => {
			draft.isRunning = false;
			draft.port = port;
			draft.host = host;
		});
	}

	setRunning(isRunning: boolean): void {
		this.updateState((draft) => {
			draft.isRunning = isRunning;
			if (isRunning) {
				draft.startedAt = new Date().toISOString();
			}
		});
	}
}
