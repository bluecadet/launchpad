// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

import type { Session } from "./core/session.js";

/**
 * The session broker's state slice, published at `state.plugins.session`.
 *
 * Thin canon only. The vendor Profile is an in-memory passthrough and never reaches the
 * state store, which is what keeps `GET /state` and every state patch free of
 * vendor-owned data about a person.
 */
export type SessionState = {
	/** The current Session, or `null` when nobody is at the Station. */
	current: Session | null;
	/**
	 * True while vendor lookups are failing. Describes launchpad's link to the vendor
	 * right now, not the Session — `current.degraded` is a snapshot of this flag taken
	 * when that Session's canon was last written, so the two can differ after a recovery.
	 */
	degraded: boolean;
};

declare module "@bluecadet/launchpad-utils/types" {
	interface PluginsState {
		session: SessionState;
	}
}
