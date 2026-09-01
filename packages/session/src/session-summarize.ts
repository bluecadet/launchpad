import type { Row, Section } from "@bluecadet/launchpad-utils/types";
import type { SessionState } from "./session-state.js";

/**
 * Builds the operator-facing status section.
 *
 * Nothing here is the Profile. `visitorId` is a vendor-opaque handle and `sessionId` is
 * launchpad's own, so a status snapshot pasted into a ticket carries no visitor data.
 */
export function buildSessionSection(state: SessionState): Section {
	const current = state.current;

	const rows: Row[] = [
		{
			type: "kv",
			label: "session",
			value: current ? current.sessionId : "none",
			tone: current ? "ok" : "neutral",
		},
		{ type: "kv", label: "visitor", value: current ? current.visitorId : "—", tone: "neutral" },
		{ type: "kv", label: "language", value: current ? current.language : "—", tone: "neutral" },
		{
			type: "kv",
			label: "vendor",
			value: state.degraded ? "degraded" : "ok",
			tone: state.degraded ? "warn" : "ok",
		},
		{ type: "kv", label: "seq", value: current ? String(current.seq) : "—", tone: "neutral" },
	];

	return { name: "session", order: 40, title: "Session", rows };
}
