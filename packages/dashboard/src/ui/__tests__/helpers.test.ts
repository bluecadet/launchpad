import { describe, expect, it } from "vitest";
import { escapeHtml, html, raw } from "../helpers.js";

describe("escapeHtml", () => {
	it("escapes all five special HTML characters", () => {
		expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
	});

	it("leaves safe strings unchanged", () => {
		expect(escapeHtml("hello world 123")).toBe("hello world 123");
	});

	it("escapes multiple occurrences", () => {
		expect(escapeHtml("<a>&<b>")).toBe("&lt;a&gt;&amp;&lt;b&gt;");
	});
});

describe("raw", () => {
	it("returns an object with the original string", () => {
		const result = raw("<strong>hello</strong>");
		expect(result.value).toBe("<strong>hello</strong>");
	});
});

describe("html", () => {
	it("passes through plain string literals unchanged", () => {
		expect(html`<p>hello</p>`).toBe("<p>hello</p>");
	});

	it("auto-escapes interpolated strings", () => {
		const userInput = '<script>alert("xss")</script>';
		expect(html`<p>${userInput}</p>`).toBe(
			"<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>",
		);
	});

	it("does not escape values wrapped with raw()", () => {
		const trusted = "<strong>bold</strong>";
		expect(html`<p>${raw(trusted)}</p>`).toBe("<p><strong>bold</strong></p>");
	});

	it("outputs nothing for null and undefined", () => {
		expect(html`<p>${null}</p>`).toBe("<p></p>");
		expect(html`<p>${undefined}</p>`).toBe("<p></p>");
	});

	it("converts numbers to strings without escaping", () => {
		expect(html`<p>${42}</p>`).toBe("<p>42</p>");
	});

	it("can be composed — html inside html via raw()", () => {
		const inner = html`<em>${"<b>"}</em>`;
		expect(html`<div>${raw(inner)}</div>`).toBe("<div><em>&lt;b&gt;</em></div>");
	});
});
