import { describe, expect, it } from "vitest";
import { toSessionId, toVisitorId } from "../core/ids.js";
import type { Session } from "../core/session.js";
import type { SessionState } from "../session-state.js";
import { buildSessionSection } from "../session-summarize.js";

const ACTIVE: Session = {
	sessionId: toSessionId("session-1"),
	visitorId: toVisitorId("v-ada"),
	language: "es",
	degraded: false,
	seq: 3,
};

function rowValue(state: SessionState, label: string): string {
	const row = buildSessionSection(state).rows.find(
		(candidate) => candidate.type === "kv" && candidate.label === label,
	);
	if (row?.type !== "kv") throw new Error(`no row labelled ${label}`);
	return row.value;
}

describe("buildSessionSection", () => {
	it("reports an idle Station", () => {
		const state: SessionState = { current: null, degraded: false };

		expect(rowValue(state, "session")).toBe("none");
		expect(rowValue(state, "visitor")).toBe("—");
		expect(rowValue(state, "seq")).toBe("—");
	});

	it("reports the active Session", () => {
		const state: SessionState = { current: ACTIVE, degraded: false };

		expect(rowValue(state, "session")).toBe("session-1");
		expect(rowValue(state, "visitor")).toBe("v-ada");
		expect(rowValue(state, "language")).toBe("es");
		expect(rowValue(state, "seq")).toBe("3");
	});

	it("warns while the vendor link is down", () => {
		const section = buildSessionSection({ current: ACTIVE, degraded: true });
		const vendorRow = section.rows.find((row) => row.type === "kv" && row.label === "vendor");

		expect(vendorRow).toEqual({ type: "kv", label: "vendor", value: "degraded", tone: "warn" });
	});

	it("never carries anything beyond the thin canon", () => {
		const section = buildSessionSection({ current: ACTIVE, degraded: false });

		expect(section.rows).toHaveLength(5);
		expect(section).toMatchObject({ name: "session", title: "Session" });
	});
});
