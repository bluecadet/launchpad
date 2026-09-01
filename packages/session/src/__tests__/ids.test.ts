import { describe, expect, it } from "vitest";
import { newSessionId, toSessionId, toVisitorId } from "../core/ids.js";

describe("Session and Visitor ids", () => {
	describe("toVisitorId", () => {
		it("brands a vendor string without changing it", () => {
			expect(toVisitorId("visitor-abc")).toBe("visitor-abc");
		});

		it("trims surrounding whitespace", () => {
			expect(toVisitorId("  visitor-abc \n")).toBe("visitor-abc");
		});

		it("throws on an empty string", () => {
			expect(() => toVisitorId("")).toThrow(TypeError);
		});

		it("throws on a whitespace-only string", () => {
			expect(() => toVisitorId("   ")).toThrow(/VisitorId/);
		});
	});

	describe("toSessionId", () => {
		it("brands an existing string without changing it", () => {
			expect(toSessionId("session-1")).toBe("session-1");
		});

		it("throws on an empty string", () => {
			expect(() => toSessionId("")).toThrow(/SessionId/);
		});
	});

	describe("newSessionId", () => {
		it("mints a distinct id each time", () => {
			const ids = new Set([newSessionId(), newSessionId(), newSessionId()]);
			expect(ids.size).toBe(3);
		});

		it("mints a plain string at runtime", () => {
			expect(typeof newSessionId()).toBe("string");
		});
	});
});
