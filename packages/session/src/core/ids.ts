import type { Brand } from "@bluecadet/launchpad-utils/types";

/**
 * Identifier for one Session — a visitor's presence at one Station.
 *
 * Minted by launchpad, never by the vendor. Branded so it cannot be crossed with a
 * {@link VisitorId}: a Visitor identifier landing in a Session slot would put
 * vendor-resolved identity into state, logs, and event payloads.
 */
export type SessionId = Brand<string, "SessionId">;

/**
 * Identifier for one Visitor, as the vendor resolved it from a Credential.
 *
 * Opaque to launchpad — never parsed, never interpreted, only forwarded.
 */
export type VisitorId = Brand<string, "VisitorId">;

function requireNonEmpty(raw: string, kind: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		throw new TypeError(`${kind} must be a non-empty string`);
	}
	return trimmed;
}

/**
 * Brands an existing string as a {@link SessionId} — for values read back off the wire
 * or out of the state store. Throws on an empty string, which is always a bug in the
 * caller rather than a reportable runtime failure.
 */
export function toSessionId(raw: string): SessionId {
	return requireNonEmpty(raw, "SessionId") as SessionId;
}

/**
 * Brands a vendor-supplied string as a {@link VisitorId}. Throws on an empty string.
 */
export function toVisitorId(raw: string): VisitorId {
	return requireNonEmpty(raw, "VisitorId") as VisitorId;
}

/**
 * Mints a fresh {@link SessionId}. Sessions do not survive a daemon restart, so the id
 * only has to be unique within one process lifetime; a UUID is used so that clients
 * reconnecting across a restart can tell old ids from new ones.
 */
export function newSessionId(): SessionId {
	return crypto.randomUUID() as SessionId;
}
