/**
 * Dashboard plugin event types.
 * Augments the global LaunchpadEvents interface via declaration merging.
 */

// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

/** Dashboard plugin event types for use with generic EventBus. */
export type DashboardEvents = {
	"dashboard:server:started": { port: number; host: string };
	"dashboard:server:stopped": Record<string, never>;
	"dashboard:server:error": { error: Error };
};

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents extends DashboardEvents {}
}
