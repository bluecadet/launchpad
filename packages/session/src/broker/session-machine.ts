import { newSessionId, type SessionId, type VisitorId } from "../core/ids.js";
import type { Session } from "../core/session.js";

/** Why a Session stopped being the current one. */
export type SessionEndReason =
	/** A different Credential was tapped at this Station. */
	| "replaced"
	/** No tap arrived before the idle timeout elapsed. */
	| "timeout"
	/** Something dispatched `session.end`. */
	| "explicit";

/**
 * A change the machine decided on, for its caller to publish.
 *
 * The machine touches no event bus, no state store, and no timer — it answers "what
 * changed" and leaves every side effect to the broker. That is what makes the whole
 * state machine testable with a hand-cranked clock and no `PluginContext`.
 */
export type SessionEffect =
	| { readonly type: "started"; readonly session: Session }
	| { readonly type: "ended"; readonly session: Session; readonly reason: SessionEndReason }
	/** The canon changed. Emitted alongside every start, end, and refresh. */
	| { readonly type: "current"; readonly session: Session | null }
	/** The vendor link crossed the healthy/unreachable line. */
	| { readonly type: "degraded"; readonly degraded: boolean };

/** A tap the broker has already put through the vendor. */
export type ResolvedTap = {
	/**
	 * Ingress order, from {@link SessionMachine.nextTapSeq}. Vendor lookups run
	 * concurrently and can finish out of order, so the machine orders taps by when they
	 * arrived rather than by when they resolved.
	 */
	readonly tapSeq: number;
	/** The Credential that was tapped. Compared for identity only, never interpreted. */
	readonly credential: string;
	readonly visitorId: VisitorId;
	readonly language: string;
	/** Whether this tap was serviced without a fresh Profile from the vendor. */
	readonly degraded: boolean;
};

/** Everything the broker publishes to the state store. Thin canon only. */
export type SessionSnapshot = {
	readonly current: Session | null;
	readonly degraded: boolean;
};

export type SessionMachineOptions = {
	/** How long a Session survives without a tap. */
	readonly idleTimeoutMs: number;
	/** Milliseconds since the epoch. Injectable so tests can move time by hand. */
	readonly now?: () => number;
	readonly mintSessionId?: () => SessionId;
};

/**
 * The Station's Session state machine: `idle` or `active(session)`, with `degraded` as an
 * orthogonal flag describing the vendor link rather than the Session.
 *
 * Synchronous and side-effect free by design. It owns no timer: it publishes
 * {@link SessionMachine.expiresAt} and expects its caller to call
 * {@link SessionMachine.expireIdle} at or after that instant, which the machine
 * re-checks against its own clock so a timer that outlived a refresh cannot end a live
 * Session.
 */
export class SessionMachine {
	private readonly idleTimeoutMs: number;
	private readonly now: () => number;
	private readonly mintSessionId: () => SessionId;

	private session: Session | null = null;
	/**
	 * The Credential behind the active Session. Held in memory only — a Credential never
	 * reaches the state store, an event payload, or a log line.
	 */
	private activeCredential: string | null = null;
	private vendorUnreachable = false;
	private deadline: number | null = null;
	private seq = 0;
	private tapCounter = 0;
	private lastAppliedTapSeq = 0;
	private lastHealthTapSeq = 0;

	constructor(options: SessionMachineOptions) {
		this.idleTimeoutMs = options.idleTimeoutMs;
		this.now = options.now ?? Date.now;
		this.mintSessionId = options.mintSessionId ?? newSessionId;
	}

	/** The thin canon, ready for the state store. */
	get snapshot(): SessionSnapshot {
		return { current: this.session, degraded: this.vendorUnreachable };
	}

	/** When the active Session goes idle, or `null` when there is nothing to expire. */
	get expiresAt(): number | null {
		return this.deadline;
	}

	/**
	 * Stamps a tap with its ingress order. Call this the moment a tap arrives, before the
	 * vendor lookup, so a slow lookup cannot jump ahead of a tap that landed after it.
	 */
	nextTapSeq(): number {
		this.tapCounter += 1;
		return this.tapCounter;
	}

	/**
	 * Records what the vendor did about the tap stamped `tapSeq`. Only the transitions
	 * are announced, so a Station with a dead vendor emits one `degraded` effect rather
	 * than one per tap.
	 *
	 * Ordered by ingress like {@link applyTap}, and for the same reason: an older tap's
	 * lookup can fail after a newer one has already succeeded, and that stale failure
	 * must not put a Station with a working vendor link into degraded mode.
	 */
	recordVendorHealth(healthy: boolean, tapSeq: number): SessionEffect[] {
		if (tapSeq <= this.lastHealthTapSeq) return [];
		this.lastHealthTapSeq = tapSeq;
		if (this.vendorUnreachable === !healthy) return [];
		this.vendorUnreachable = !healthy;
		return [{ type: "degraded", degraded: this.vendorUnreachable }];
	}

	/**
	 * Applies a resolved tap: last tap wins. The same Credential refreshes the Session in
	 * place; a different one ends the current Session as `replaced` and starts a new one.
	 * A tap whose lookup finished after a newer tap was already applied is dropped.
	 */
	applyTap(tap: ResolvedTap): SessionEffect[] {
		if (tap.tapSeq <= this.lastAppliedTapSeq) return [];
		this.lastAppliedTapSeq = tap.tapSeq;

		const active = this.session;
		const effects =
			active && this.activeCredential === tap.credential
				? this.refresh(active, tap)
				: [...(active ? this.closeSession(active, "replaced") : []), ...this.start(tap)];

		// Armed last: ending the Session it replaces clears the deadline on the way past.
		this.deadline = this.now() + this.idleTimeoutMs;
		return effects;
	}

	/**
	 * Ends the Session if the idle deadline has actually passed. The deadline is
	 * re-checked here because the broker's timer may have been armed against an older
	 * deadline that a re-tap has since pushed out.
	 */
	expireIdle(): SessionEffect[] {
		const active = this.session;
		if (!active || this.deadline === null || this.now() < this.deadline) return [];
		return this.closeSession(active, "timeout");
	}

	/**
	 * Ends the Session on request. A no-op when the Station is already idle.
	 *
	 * Every tap stamped so far is retired along with the Session: an explicit end is a
	 * deliberate "clear this Station now", so a lookup still in flight when it lands
	 * must not open a Session after the caller was told the Station is idle.
	 */
	end(): SessionEffect[] {
		const active = this.session;
		this.lastAppliedTapSeq = this.tapCounter;
		return active ? this.closeSession(active, "explicit") : [];
	}

	private refresh(active: Session, tap: ResolvedTap): SessionEffect[] {
		this.seq += 1;
		this.session = {
			...active,
			language: tap.language,
			degraded: tap.degraded,
			seq: this.seq,
		};
		return [{ type: "current", session: this.session }];
	}

	private start(tap: ResolvedTap): SessionEffect[] {
		this.seq += 1;
		this.session = {
			sessionId: this.mintSessionId(),
			visitorId: tap.visitorId,
			language: tap.language,
			degraded: tap.degraded,
			seq: this.seq,
		};
		this.activeCredential = tap.credential;
		return [
			{ type: "started", session: this.session },
			{ type: "current", session: this.session },
		];
	}

	private closeSession(active: Session, reason: SessionEndReason): SessionEffect[] {
		this.session = null;
		this.activeCredential = null;
		this.deadline = null;
		const ended: SessionEffect = { type: "ended", session: active, reason };
		// A replacement publishes its own `current`; anything else lands on idle.
		return reason === "replaced" ? [ended] : [ended, { type: "current", session: null }];
	}
}
