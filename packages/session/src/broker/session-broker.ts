import { ensureError } from "@bluecadet/launchpad-utils/errors";
import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { okAsync, type ResultAsync } from "neverthrow";
import type { VisitorId } from "../core/ids.js";
import { type Profile, unsealProfile } from "../core/profile.js";
import type { Unsubscribe } from "../core/vendor-client.js";
import type {
	SessionCurrentResult,
	SessionEndResult,
	SessionTapSimulateResult,
} from "../session-commands.js";
import type { ResolvedSessionConfig } from "../session-config.js";
import type { SessionState } from "../session-state.js";
import { type SessionEffect, SessionMachine } from "./session-machine.js";

import "../session-events.js";

/** Everything the broker needs from its `PluginContext`, and nothing more. */
export type SessionBrokerDeps = {
	readonly logger: Logger;
	readonly eventBus: EventBus;
	readonly updateState: (producer: (draft: SessionState) => void) => void;
	/** Cancels in-flight vendor lookups when the controller shuts down. */
	readonly abortSignal: AbortSignal;
};

/**
 * Owns this Node's vendor link and the Station's current Session.
 *
 * Taps run concurrently — a slow lookup must never block the tap behind it — so the
 * broker holds no lock and instead lets {@link SessionMachine} order taps by ingress.
 * The machine decides what changed; the broker performs the effects: emit, publish
 * state, re-arm the idle timer.
 */
export class SessionBroker {
	private readonly machine: SessionMachine;
	/**
	 * Last Profile seen per Visitor, so a Profile outage can still open a Session with
	 * the right language instead of the configured fallback. Memory only: it is dropped
	 * on disconnect and never written to disk.
	 */
	private readonly cachedProfiles = new Map<VisitorId, Profile>();

	/** The Profile behind the current Session, held for passthrough on `session.current`. */
	private activeProfile: Profile | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private unsubscribeTaps: Unsubscribe | null = null;
	private stopped = false;

	constructor(
		private readonly config: ResolvedSessionConfig,
		private readonly deps: SessionBrokerDeps,
	) {
		this.machine = new SessionMachine({ idleTimeoutMs: config.idleTimeoutMs });
	}

	/** Publishes the initial idle state and starts listening for taps. */
	start(): void {
		this.publishState();
		this.unsubscribeTaps = this.config.vendor.subscribeTaps((tap) => {
			// Tap handlers are fire-and-forget, so nothing is here to await the result.
			// An adapter that throws synchronously, or hands back a promise that rejects,
			// would otherwise surface as an unhandled rejection somewhere unrelated.
			this.handleTap(tap.credential).catch((error: unknown) => {
				this.deps.logger.error("Failed to service a Credential tap", {
					vendor: this.config.vendor.name,
					error: ensureError(error).message,
				});
			});
		});
	}

	/** The current canon plus the Profile behind it. Backs the `session.current` command. */
	current(): SessionCurrentResult {
		return {
			session: this.machine.snapshot.current,
			profile: this.activeProfile === null ? null : unsealProfile(this.activeProfile),
		};
	}

	/** Backs the `session.end` command. Ending an idle Station is an ordinary no-op. */
	end(): SessionEndResult {
		const ending = this.machine.snapshot.current;
		const effects = this.machine.end();
		this.publish(effects);
		return { ended: effects.length > 0, sessionId: ending?.sessionId ?? null };
	}

	/** Backs the `session.tap.simulate` command. Resolves once the tap has been serviced. */
	async simulateTap(credential: string): Promise<SessionTapSimulateResult> {
		const before = this.machine.snapshot.current;
		await this.handleTap(credential);
		const after = this.machine.snapshot.current;
		return { accepted: after !== before, session: after };
	}

	/** Detaches from the vendor, cancels the idle timer, and drops every cached Profile. */
	stop(): ResultAsync<void, Error> {
		this.stopped = true;
		this.unsubscribeTaps?.();
		this.unsubscribeTaps = null;
		this.clearIdleTimer();
		this.cachedProfiles.clear();
		this.activeProfile = null;
		return this.config.vendor.disconnect?.() ?? okAsync(undefined);
	}

	/**
	 * Runs one tap through the vendor and applies the outcome. Resolves when the tap has
	 * been serviced, which is what lets `session.tap.simulate` answer with the result.
	 */
	private async handleTap(credential: string): Promise<void> {
		const tapSeq = this.machine.nextTapSeq();
		const signal = this.deps.abortSignal;

		const resolved = await this.config.vendor.resolveCredential(credential, { signal });
		if (this.stopped) return;

		if (resolved.isErr()) {
			// A Credential cannot be resolved without the vendor, and the Visitor behind
			// it is exactly what the Profile cache is keyed by — so there is nothing to
			// fall back to and the tap is dropped.
			this.deps.logger.warn("Vendor could not resolve a tapped Credential", {
				vendor: this.config.vendor.name,
				error: resolved.error.message,
			});
			this.publish(this.machine.recordVendorHealth(false, tapSeq));
			return;
		}

		const visitorId = resolved.value;
		if (visitorId === null) {
			// An ordinary outcome: a wristband from somewhere else. The vendor answered,
			// so the link is healthy. The Credential itself is never logged.
			this.deps.logger.debug("Vendor did not recognize a tapped Credential", {
				vendor: this.config.vendor.name,
			});
			this.publish(this.machine.recordVendorHealth(true, tapSeq));
			return;
		}

		const fetched = await this.config.vendor.fetchProfile(visitorId, { signal });
		if (this.stopped) return;

		if (fetched.isErr()) {
			this.deps.logger.warn("Vendor Profile lookup failed; opening a degraded Session", {
				vendor: this.config.vendor.name,
				error: fetched.error.message,
			});
			this.publish(this.machine.recordVendorHealth(false, tapSeq));
			this.applyTap(
				tapSeq,
				credential,
				visitorId,
				this.cachedProfiles.get(visitorId) ?? null,
				true,
			);
			return;
		}

		this.cachedProfiles.set(visitorId, fetched.value);
		this.publish(this.machine.recordVendorHealth(true, tapSeq));
		this.applyTap(tapSeq, credential, visitorId, fetched.value, false);
	}

	private applyTap(
		tapSeq: number,
		credential: string,
		visitorId: VisitorId,
		profile: Profile | null,
		degraded: boolean,
	): void {
		const effects = this.machine.applyTap({
			tapSeq,
			credential,
			visitorId,
			language: profile?.language ?? this.config.fallbackLanguage,
			degraded,
		});
		// An empty effect list means a newer tap already won the race, so this tap's
		// Profile must not become the passthrough either.
		if (effects.length === 0) return;
		this.activeProfile = profile;
		this.publish(effects);
	}

	private publish(effects: readonly SessionEffect[]): void {
		if (effects.length === 0) return;
		for (const effect of effects) this.emit(effect);
		if (this.machine.snapshot.current === null) this.activeProfile = null;
		this.publishState();
		this.armIdleTimer();
	}

	private emit(effect: SessionEffect): void {
		switch (effect.type) {
			case "started":
				this.deps.eventBus.emit("session:started", { session: effect.session });
				return;
			case "ended":
				this.deps.eventBus.emit("session:ended", {
					session: effect.session,
					reason: effect.reason,
				});
				return;
			case "current":
				this.deps.eventBus.emit("session:current", { session: effect.session });
				return;
			case "degraded":
				this.deps.eventBus.emit("session:degraded", { degraded: effect.degraded });
				return;
			default:
				effect satisfies never;
		}
	}

	private publishState(): void {
		const { current, degraded } = this.machine.snapshot;
		this.deps.updateState((draft) => {
			draft.current = current;
			draft.degraded = degraded;
		});
	}

	/**
	 * Re-arms against the machine's deadline after every change. The machine re-checks
	 * the deadline when the timer fires, so an early wake-up cannot end a live Session.
	 */
	private armIdleTimer(): void {
		this.clearIdleTimer();
		const expiresAt = this.machine.expiresAt;
		if (expiresAt === null) return;

		const timer = setTimeout(
			() => {
				this.publish(this.machine.expireIdle());
			},
			Math.max(0, expiresAt - Date.now()),
		);
		// An idle Session is not work: the timer must never be the reason a task-mode run
		// refuses to exit.
		timer.unref?.();
		this.idleTimer = timer;
	}

	private clearIdleTimer(): void {
		if (this.idleTimer === null) return;
		clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}
}
