/**
 * The current Session at this Station, reconciled from push and poll.
 *
 * The broker's events carry the thin canon and nothing else — the vendor Profile never
 * travels on an event, because events fan out to every authenticated SSE client and to
 * every observability sink watching the bus. `session.current` is the only place a
 * Profile crosses the wire, so this view re-queries that command whenever the Session
 * identity changes, and applies the canon-only events locally in between.
 *
 * Everything else here is the same push-as-sugar discipline the state mirror follows: a
 * gap, a reconnect, or a Session this view has no Profile for is answered by asking the
 * authoritative command, never by replaying history.
 */

import type { ProfileData, Session, SessionCurrentResult } from "@bluecadet/launchpad-session";
import type { CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { ResultAsync } from "neverthrow";
import type { CommandError, LaunchpadClientError } from "./errors.js";
import { type EventFrame, type EventStream, isResyncSignal } from "./event-stream.js";
import { isRecord } from "./http.js";
import type { SubscribeOptions, Unsubscribe } from "./types.js";

/** What an app renders from: the canon, the Profile behind it, and the vendor link. */
export type SessionView = {
	/** The Session at this Station, or `null` when nobody is here. */
	readonly session: Session | null;
	/** Vendor-owned Profile for that Session. `null` when the Station is idle. */
	readonly profile: ProfileData | null;
	/**
	 * True while launchpad's link to the vendor is failing. Sourced from
	 * `session:degraded` transitions, falling back to the current Session's own snapshot
	 * of the flag when no transition has been observed.
	 */
	readonly degraded: boolean;
};

export type SessionViewDeps = {
	runCommand: <TResult>(
		type: CommandId,
		params?: Record<string, unknown>,
	) => ResultAsync<TResult, CommandError>;
	stream: EventStream;
	onError?: (error: LaunchpadClientError) => void;
};

const IDLE_VIEW: SessionView = { session: null, profile: null, degraded: false };

function isSession(value: unknown): value is Session {
	return (
		isRecord(value) &&
		typeof value.sessionId === "string" &&
		typeof value.visitorId === "string" &&
		typeof value.language === "string" &&
		typeof value.degraded === "boolean" &&
		typeof value.seq === "number"
	);
}

/** `null` for an explicit idle canon, `undefined` when the payload made no sense. */
function readSession(value: unknown): Session | null | undefined {
	if (value === null) {
		return null;
	}
	return isSession(value) ? value : undefined;
}

function readProfile(value: unknown): ProfileData | null {
	return isRecord(value) ? value : null;
}

/**
 * A newer canon supersedes the current one. `seq` is a revision of one Session, not a
 * global counter, so it is only comparable within the same `sessionId`.
 */
function supersedes(current: Session | null, incoming: Session): boolean {
	if (current === null || current.sessionId !== incoming.sessionId) {
		return true;
	}
	return incoming.seq > current.seq;
}

export function subscribeSessionView(
	deps: SessionViewDeps,
	handler: (view: SessionView) => void,
	options?: SubscribeOptions,
): Unsubscribe {
	if (options?.signal?.aborted) {
		return () => undefined;
	}

	let view: SessionView = IDLE_VIEW;
	/** Which Session the Profile in `view` belongs to. */
	let profileFor: string | null = null;
	/** Bumped by every locally applied event, so a stale command result can be dropped. */
	let revision = 0;
	let querying = false;
	let queryQueued = false;
	/** Set when an answer landed on a canon that had already moved, so it was thrown away. */
	let answerDropped = false;
	/** The last `session:degraded` transition seen, if any. */
	let degradedFromEvent: boolean | undefined;
	let stopped = false;

	function emit(next: SessionView) {
		view = next;
		handler(view);
	}

	function queryCurrent() {
		if (stopped) {
			return;
		}
		if (querying) {
			// A resync that lands mid-query still needs its own answer.
			queryQueued = true;
			return;
		}
		querying = true;
		answerDropped = false;
		const issuedAt = revision;
		void deps
			.runCommand<SessionCurrentResult>("session.current")
			.match(
				(result) => {
					if (stopped) {
						return;
					}
					if (revision !== issuedAt) {
						// An event moved the canon while this was in flight, so this answer is no
						// longer news. Nothing else carries a Profile, so ask again once it settles.
						answerDropped = true;
						return;
					}
					const session = readSession(result.session) ?? null;
					const profile = readProfile(result.profile);
					profileFor = session?.sessionId ?? null;
					// A `session:degraded` transition is more current than the flag this Session's
					// canon was written with, which is a snapshot of the link at that moment.
					emit({
						session,
						profile,
						degraded: degradedFromEvent ?? session?.degraded ?? view.degraded,
					});
				},
				(error) => {
					if (!stopped) {
						// The last known view stands: a Session does not survive a daemon restart,
						// and an app is better off holding its screen than blanking on a blip.
						deps.onError?.(error);
					}
				},
			)
			.finally(() => {
				querying = false;
				if (queryQueued) {
					queryQueued = false;
					queryCurrent();
					return;
				}
				if (answerDropped) {
					// Exactly one re-issue per discarded answer: the flag is cleared as the next
					// query goes out, so this only repeats while events keep landing mid-flight.
					queryCurrent();
					return;
				}
				ensureProfile();
			});
	}

	/** The Profile only ever arrives by command, so a new Session always needs a query. */
	function ensureProfile() {
		if (!stopped && view.session !== null && view.session.sessionId !== profileFor) {
			queryCurrent();
		}
	}

	function applyCanon(session: Session | null) {
		revision += 1;
		if (session === null) {
			profileFor = null;
			emit({ session: null, profile: null, degraded: view.degraded });
			return;
		}
		const profile = session.sessionId === profileFor ? view.profile : null;
		emit({ session, profile, degraded: view.degraded });
		ensureProfile();
	}

	function handleStarted(data: unknown) {
		const session = isRecord(data) ? readSession(data.session) : undefined;
		if (session && supersedes(view.session, session)) {
			applyCanon(session);
		}
	}

	/**
	 * An end applies only to the Session the view is holding, and only from that Session's
	 * current revision onwards. The broker ends a Session without bumping its `seq`, so an
	 * end carrying the revision already held is the ordinary case, not a stale frame.
	 */
	function handleEnded(data: unknown) {
		const session = isRecord(data) ? readSession(data.session) : undefined;
		if (!session || view.session === null) {
			return;
		}
		if (view.session.sessionId !== session.sessionId || session.seq < view.session.seq) {
			return;
		}
		applyCanon(null);
	}

	function handleCurrent(data: unknown) {
		const session = isRecord(data) ? readSession(data.session) : undefined;
		if (session === undefined) {
			return;
		}
		if (session === null || supersedes(view.session, session)) {
			applyCanon(session);
		}
	}

	function handleDegraded(data: unknown) {
		if (!isRecord(data) || typeof data.degraded !== "boolean") {
			return;
		}
		degradedFromEvent = data.degraded;
		revision += 1;
		emit({ ...view, degraded: data.degraded });
	}

	function handleFrame(frame: EventFrame) {
		// A replayed backlog frame is a stale snapshot of the canon, and this view already
		// asks `session.current` on subscribe and on every reconnect.
		if (frame.replayed) {
			return;
		}
		switch (frame.event) {
			case "session:started":
				return handleStarted(frame.data);
			case "session:ended":
				return handleEnded(frame.data);
			case "session:current":
				return handleCurrent(frame.data);
			case "session:degraded":
				return handleDegraded(frame.data);
			default:
				return;
		}
	}

	const unsubscribeStream = deps.stream.subscribe(
		{
			onFrame: handleFrame,
			onConnection: (event) => {
				if (isResyncSignal(event)) {
					queryCurrent();
				}
			},
		},
		options,
	);

	const stop = () => {
		stopped = true;
		options?.signal?.removeEventListener("abort", stop);
		unsubscribeStream();
	};
	options?.signal?.addEventListener("abort", stop, { once: true });

	queryCurrent();

	return stop;
}
