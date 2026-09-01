import type { SessionId, VisitorId } from "./ids.js";

/**
 * The thin canon of a Session: one visitor's presence at one Station, reduced to the
 * only fields allowed into the state store and event payloads.
 *
 * Everything else the vendor knows stays in the passthrough Profile. Two of these
 * fields come from the vendor and three are launchpad's own bookkeeping — see the field
 * docs. Nothing here identifies a person: `visitorId` is a vendor-opaque handle.
 */
export type Session = {
	/** Launchpad-minted identifier for this Session. The only id observability ever sees. */
	readonly sessionId: SessionId;
	/** Vendor-resolved Visitor behind the tapped Credential. Opaque; never parsed. */
	readonly visitorId: VisitorId;
	/** BCP-47 language tag the Station app should render in. */
	readonly language: string;
	/**
	 * True when this Session was built without a usable Profile — the vendor could not be
	 * reached, so the Station app is running on fallback values. Launchpad's assessment of
	 * its own vendor link, not something the vendor reports.
	 */
	readonly degraded: boolean;
	/**
	 * Monotonic revision of this Session. Clients that spot a gap re-query authoritative
	 * state rather than replaying events. Owned by the broker that emits the events.
	 */
	readonly seq: number;
};
