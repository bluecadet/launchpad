/**
 * Session broker runtime commands, dispatched through the controller.
 *
 * `session.current` is the authoritative query behind every session event: push is
 * best-effort sugar, so a client that misses an event — or has just restarted — asks
 * here rather than replaying history.
 */

import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";
import type { SessionId } from "./core/ids.js";
import type { ProfileData } from "./core/profile.js";
import type { Session } from "./core/session.js";

/** Reads the current Session canon, plus the Profile behind it. */
export type SessionCurrentCommand = BaseCommand & { type: "session.current" };

/** Ends the current Session now. */
export type SessionEndCommand = BaseCommand & { type: "session.end" };

/** Feeds a Credential through the same path a real tap takes. Dev and QA only. */
export type SessionTapSimulateCommand = BaseCommand & {
	type: "session.tap.simulate";
	credential: string;
};

export type SessionCommand = SessionCurrentCommand | SessionEndCommand | SessionTapSimulateCommand;

/**
 * Result of `session.current`.
 *
 * The Profile is the one place vendor-owned data crosses the wire: it is passed through
 * from memory and is deliberately absent from every session event, so a log sink or an
 * SSE subscriber watching events never sees it.
 */
export type SessionCurrentResult = {
	readonly session: Session | null;
	/** Vendor-owned Profile behind the current Session. `null` when the Station is idle. */
	readonly profile: ProfileData | null;
};

/** Result of `session.end`. */
export type SessionEndResult = {
	/** False when the Station was already idle — an ordinary outcome, not a failure. */
	readonly ended: boolean;
	/** The Session that was ended, or `null` when there was nothing to end. */
	readonly sessionId: SessionId | null;
};

/** Result of `session.tap.simulate`. */
export type SessionTapSimulateResult = {
	/** False when the vendor did not recognize the Credential and no Session changed. */
	readonly accepted: boolean;
	/** The canon once the simulated tap had been serviced. */
	readonly session: Session | null;
};

export const sessionCurrentCommandSchema = z
	.object({ type: z.literal("session.current") })
	.strict();

export const sessionEndCommandSchema = z.object({ type: z.literal("session.end") }).strict();

export const sessionTapSimulateCommandSchema = z
	.object({
		type: z.literal("session.tap.simulate"),
		credential: z.string().min(1),
	})
	.strict();

export const sessionCommandSchema = z.discriminatedUnion("type", [
	sessionCurrentCommandSchema,
	sessionEndCommandSchema,
	sessionTapSimulateCommandSchema,
]);
