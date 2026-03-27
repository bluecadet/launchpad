import { describe, expect, it } from "vitest";
import { commandButton } from "../command-button.js";

describe("commandButton", () => {
	it("renders hx-post and hx-vals attributes", () => {
		const result = commandButton("Restart", { type: "monitor.restart" });
		expect(result).toContain('hx-post="/commands"');
		expect(result).toContain('"type":"monitor.restart"');
	});

	it("includes the label in the button text", () => {
		const result = commandButton("Stop All", { type: "monitor.stop" });
		expect(result).toContain(">Stop All<");
	});

	it("escapes label HTML to prevent injection", () => {
		const result = commandButton('<img onerror="xss">', { type: "test" });
		expect(result).toContain("&lt;img");
		expect(result).not.toContain("<img");
	});

	it("includes hx-confirm when confirm option is set", () => {
		const result = commandButton("Delete", { type: "x" }, { confirm: "Are you sure?" });
		expect(result).toContain('hx-confirm="Are you sure?"');
	});

	it("escapes the confirm message", () => {
		const result = commandButton("X", { type: "x" }, { confirm: 'Say "yes"' });
		expect(result).toContain("&quot;yes&quot;");
	});

	it("adds disabled attribute when disabled option is true", () => {
		const result = commandButton("X", { type: "x" }, { disabled: true });
		expect(result).toContain(" disabled");
	});

	it("applies default btn class when no class option given", () => {
		const result = commandButton("X", { type: "x" });
		expect(result).toContain('class="btn"');
	});

	it("applies custom class when class option is set", () => {
		const result = commandButton("X", { type: "x" }, { class: "btn btn--danger" });
		expect(result).toContain('class="btn btn--danger"');
	});

	it("serializes additional command properties into hx-vals", () => {
		const result = commandButton("Start", { type: "monitor.start", appNames: ["web", "api"] });
		expect(result).toContain('"appNames":["web","api"]');
	});
});
