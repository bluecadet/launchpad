/**
 * Monitor subsystem events.
 *
 * This file uses TypeScript declaration merging to add monitor-specific
 * events to the LaunchpadEvents interface from the controller package.
 *
 * When @bluecadet/launchpad-controller is installed, these events become
 * fully type-safe. When it's not installed, the events can still be emitted
 * but without type checking.
 */

declare module "@bluecadet/launchpad-controller" {
	interface LaunchpadEvents {
		// Connection lifecycle
		"monitor:connect:start": Record<string, never>;

		"monitor:connect:done": {
			appCount: number;
		};

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

/**
 * Type-safe event emitter helper for monitor events.
 * This ensures monitor code emits events with the correct payload shape.
 */
export type MonitorEventEmitter = {
	emit<K extends keyof import("@bluecadet/launchpad-controller").LaunchpadEvents>(
		event: K,
		data: import("@bluecadet/launchpad-controller").LaunchpadEvents[K],
	): boolean;
	emit(event: string, data: unknown): boolean;
};
