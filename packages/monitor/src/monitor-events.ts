// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

/**
 * Monitor subsystem events.
 */

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents {
		// Connection lifecycle
		"monitor:connect:start": Record<string, never>;

		"monitor:connect:done": Record<string, never>;

		"monitor:connect:error": {
			error: Error;
		};

		"monitor:disconnect:start": Record<string, never>;

		"monitor:disconnect:done": Record<string, never>;

		// App lifecycle
		"monitor:app:start": {
			appName: string;
			pm2Id?: number;
		};

		"monitor:app:started": {
			appName: string;
			pm2Id: number;
			pid: number;
		};

		"monitor:app:stop": {
			appName: string;
			pm2Id?: number;
		};

		"monitor:app:stopped": {
			appName: string;
			pm2Id: number;
		};

		"monitor:app:restart": {
			appName: string;
			pm2Id?: number;
		};

		"monitor:app:restarted": {
			appName: string;
			pm2Id: number;
			pid: number;
		};

		"monitor:app:error": {
			appName: string;
			error: Error;
			operation?: "start" | "stop" | "restart";
		};

		// App state changes
		"monitor:app:online": {
			appName: string;
			pm2Id: number;
			pid: number;
		};

		"monitor:app:exit": {
			appName: string;
			pm2Id: number;
			exitCode: number;
			signal?: string;
		};

		"monitor:app:crash": {
			appName: string;
			pm2Id: number;
			error: Error;
		};

		// App log events (from PM2 bus)
		"monitor:app:log": {
			appName: string;
			data: string;
		};

		"monitor:app:errorLog": {
			appName: string;
			data: string;
		};

		// Shutdown lifecycle
		"monitor:beforeShutdown": {
			code?: number;
		};

		// Window management (Windows-specific)
		"monitor:window:foreground": {
			appName: string;
			hwnd: number;
		};

		"monitor:window:minimize": {
			appName: string;
			hwnd: number;
		};

		"monitor:window:hide": {
			appName: string;
			hwnd: number;
		};

		"monitor:window:error": {
			appName: string;
			error: Error;
		};
	}
}
