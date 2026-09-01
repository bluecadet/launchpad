import type { ResultAsync } from "neverthrow";
import type { VisitorId } from "./ids.js";
import type { Profile } from "./profile.js";

/**
 * Options accepted by every fallible VendorClient call. An options bag rather than a
 * bare parameter so later options are additive.
 */
export type VendorCallOptions = {
	/**
	 * Abort in-flight work. An adapter must settle promptly once this fires rather than
	 * running the call to completion — callers cancel because they no longer care.
	 */
	signal?: AbortSignal;
};

/** One Credential tap, as the vendor reported it. */
export type CredentialTap = {
	/**
	 * The Credential value. Opaque: launchpad hands it straight back to
	 * {@link VendorClient.resolveCredential} and never interprets it.
	 */
	readonly credential: string;
	/** When the vendor observed the tap. */
	readonly observedAt: Date;
};

/** Called once per Credential tap. Must not throw; adapters are not error channels. */
export type TapHandler = (tap: CredentialTap) => void;

/** Detaches a tap handler. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * The seam between launchpad and a visitor-identity vendor.
 *
 * Duck-typed on purpose: a project writes a plain object satisfying this type against
 * whatever SDK, HTTP API, or serial protocol its vendor ships, and hands it to the
 * session broker. Launchpad provides the contract and `fakeVendor()`; concrete vendor
 * adapters live project-side.
 *
 * Three properties hold this shape together:
 *
 * - **No configuration surface.** Endpoints, credentials, retries, and cadence belong to
 *   the adapter that implements this, never to the type.
 * - **Tap ingest is push-shaped, one way only.** {@link subscribeTaps} makes no claim
 *   about how an adapter gets taps: a push-based vendor wires the handler to its
 *   subscription, a poll-based one owns a timer and calls the same handler. Polling
 *   cadence, jitter, and backoff never appear here.
 * - **No presence query.** Nothing asks "who is at the Station right now". Sessions do
 *   not survive a daemon restart and are not rehydrated; the visitor re-taps.
 *
 * Latency is unknown, so both lookups are async and cancellable, and callers must treat
 * either as arbitrarily slow.
 */
export type VendorClient = {
	/** Unique name used in state tracking and event payloads. */
	readonly name: string;

	/**
	 * Resolves a tapped Credential into the Visitor behind it.
	 *
	 * Returns `ok(null)` when the vendor answered but does not recognize the Credential —
	 * an ordinary outcome that should start no Session. Reserve the error channel for a
	 * broken vendor link, which is what puts a Session into degraded mode.
	 */
	resolveCredential(
		credential: string,
		options?: VendorCallOptions,
	): ResultAsync<VisitorId | null, Error>;

	/**
	 * Fetches the vendor-owned Profile for a Visitor.
	 *
	 * The returned Profile is sealed: forward it to the Station app, never store or log
	 * it. An error here is a degraded-mode signal, not a reason to drop the Session.
	 */
	fetchProfile(visitorId: VisitorId, options?: VendorCallOptions): ResultAsync<Profile, Error>;

	/**
	 * Registers a handler for Credential taps and returns its unsubscribe function.
	 *
	 * Handlers are called in registration order. No signal is accepted — unsubscribing is
	 * the cancellation.
	 */
	subscribeTaps(handler: TapHandler): Unsubscribe;

	/** Optional cleanup on shutdown. */
	disconnect?(): ResultAsync<void, Error>;
};
