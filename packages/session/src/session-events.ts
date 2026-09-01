// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

import type { SessionEndReason } from "./broker/session-machine.js";
import type { Session } from "./core/session.js";

/**
 * Session broker events.
 *
 * Every payload carries the thin canon and nothing else. The vendor Profile never
 * travels on an event: events fan out to every authenticated SSE client and to any
 * observability sink watching them, and a Profile is vendor-owned data about a person.
 * Read it from `session.current` instead.
 */
export type SessionEvents = {
	/** A new Session opened at this Station. */
	"session:started": { session: Session };

	/** The Session stopped being the current one, for the stated reason. */
	"session:ended": { session: Session; reason: SessionEndReason };

	/**
	 * The current canon, after any change — a start, an end, or a same-Credential
	 * refresh. This is the event to put in the transport's `replayEvents` so a client
	 * that connects mid-Session learns about it without waiting for the next tap.
	 */
	"session:current": { session: Session | null };

	/** The vendor link crossed the healthy/unreachable line. Emitted per transition. */
	"session:degraded": { degraded: boolean };
};

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents extends SessionEvents {}
}
