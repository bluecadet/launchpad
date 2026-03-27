import { describe, expect, it } from "vitest";
import { statusBadge } from "../status-badge.js";

describe("statusBadge", () => {
	it("includes the text in the output", () => {
		expect(statusBadge("Online", "success")).toContain("Online");
	});

	it("applies the correct level CSS class", () => {
		expect(statusBadge("OK", "success")).toContain("badge--success");
		expect(statusBadge("Warn", "warning")).toContain("badge--warning");
		expect(statusBadge("Err", "error")).toContain("badge--error");
		expect(statusBadge("Info", "info")).toContain("badge--info");
		expect(statusBadge("N/A", "neutral")).toContain("badge--neutral");
	});

	it("escapes HTML in the text", () => {
		const result = statusBadge("<b>bold</b>", "info");
		expect(result).toContain("&lt;b&gt;");
		expect(result).not.toContain("<b>");
	});
});
