import { describe, expect, it } from "vitest";
import { deriveNodeIdFromHostname, resolveNodeIdentity } from "../node-identity.js";

describe("deriveNodeIdFromHostname", () => {
	it("lowercases and keeps only the segment before the first dot", () => {
		expect(deriveNodeIdFromHostname("Gallery-Kiosk-1.local")).toBe("gallery-kiosk-1");
	});

	it("collapses runs of illegal characters into a single dash and trims the edges", () => {
		expect(deriveNodeIdFromHostname("Kiosk_A 2!!")).toBe("kiosk-a-2");
	});

	it("falls back when the hostname sanitizes down to nothing", () => {
		expect(deriveNodeIdFromHostname("")).toBe("launchpad-node");
		expect(deriveNodeIdFromHostname("...")).toBe("launchpad-node");
	});
});

describe("resolveNodeIdentity", () => {
	it("derives the id from the hostname and mirrors it into the label", () => {
		const identity = resolveNodeIdentity({}, "kiosk-1.local");

		expect(identity).toEqual({ id: "kiosk-1", label: "kiosk-1" });
		expect("role" in identity).toBe(false);
	});

	it("prefers a configured id, and the label follows it rather than the hostname", () => {
		const identity = resolveNodeIdentity({ id: "explicit" }, "kiosk-1");

		expect(identity.id).toBe("explicit");
		expect(identity.label).toBe("explicit");
	});

	it("preserves every configured field", () => {
		expect(resolveNodeIdentity({ id: "a", label: "Gallery A", role: "projection" }, "h")).toEqual({
			id: "a",
			label: "Gallery A",
			role: "projection",
		});
	});

	it("keeps a configured label alongside a hostname-derived id", () => {
		expect(resolveNodeIdentity({ label: "Only Label" }, "kiosk-1")).toEqual({
			id: "kiosk-1",
			label: "Only Label",
		});
	});
});
