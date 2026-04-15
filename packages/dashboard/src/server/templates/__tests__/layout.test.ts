import { describe, expect, it } from "vitest";
import { definePage } from "../../../dashboard-page.js";
import { renderLayout } from "../layout.js";

describe("renderLayout", () => {
	it("contains DOCTYPE and html structure", () => {
		const html = renderLayout("Test", "<p>body</p>", [], null);
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain('<html lang="en">');
		expect(html).toContain("</html>");
	});

	it("includes the title with dashboard suffix", () => {
		const html = renderLayout("My Title", "", [], null);
		expect(html).toContain("<title>My Title — Launchpad Dashboard</title>");
	});

	it("inserts body content into main", () => {
		const html = renderLayout("T", "<div>hello world</div>", [], null);
		expect(html).toContain("<div>hello world</div>");
		expect(html).toContain("<main");
	});

	it("generates nav links from pages", () => {
		const pages = [
			definePage({ id: "p1", title: "Page One" }),
			definePage({ id: "p2", title: "Page Two", path: "/custom" }),
		];
		const html = renderLayout("T", "", pages, null);
		expect(html).toContain('href="/pages/p1"');
		expect(html).toContain(">Page One<");
		expect(html).toContain('href="/custom"');
		expect(html).toContain(">Page Two<");
	});

	it("marks active page link with nav__link--active class", () => {
		const pages = [
			definePage({ id: "p1", title: "Page One" }),
			definePage({ id: "p2", title: "Page Two" }),
		];
		const html = renderLayout("T", "", pages, "p1");
		expect(html).toContain('class="nav__link--active"');
		// p2 should not have active class
		const p2Idx = html.indexOf(">Page Two<");
		const p2LinkStart = html.lastIndexOf("<a", p2Idx);
		const p2Link = html.slice(p2LinkStart, p2Idx);
		expect(p2Link).not.toContain("nav__link--active");
	});

	it("produces no nav links when pages array is empty", () => {
		const html = renderLayout("T", "", [], null);
		expect(html).not.toContain('href="/pages/');
	});

	it("includes script tags from parameters", () => {
		const html = renderLayout(
			"T",
			"",
			[],
			null,
			[{ filePath: "/tmp/test.js", url: "/assets/test-abc.js", defer: true }],
			[],
		);
		expect(html).toContain('<script src="/assets/test-abc.js" defer></script>');
	});

	it("includes style links from parameters", () => {
		const html = renderLayout(
			"T",
			"",
			[],
			null,
			[],
			[{ filePath: "/tmp/test.css", url: "/assets/test-abc.css" }],
		);
		expect(html).toContain('<link rel="stylesheet" href="/assets/test-abc.css">');
	});

	it("escapes HTML in title", () => {
		const html = renderLayout("<script>xss</script>", "", [], null);
		expect(html).toContain("&lt;script&gt;xss&lt;/script&gt;");
		expect(html).not.toContain("<title><script>");
	});
});
