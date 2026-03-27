/**
 * Dashboard plugin event types.
 * Augments the global LaunchpadEvents interface via declaration merging.
 */

// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents {
		"dashboard:server:started": { port: number; host: string };
		"dashboard:server:stopped": Record<string, never>;
		"dashboard:server:error": { error: Error };
	}
}
