import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import { describe, expect, it } from "vitest";
import { definePage } from "../../../dashboard-page.js";
import { definePanel } from "../../../dashboard-panel.js";
import { renderIndexPageBody } from "../index-page.js";

const mockState: VersionedLaunchpadState = {
	system: { startTime: new Date(), mode: "task" },
	plugins: {},
	_version: 0,
};

describe("renderIndexPageBody", () => {
	it("returns empty-state message when no pages and no panels", () => {
		const html = renderIndexPageBody([], [], mockState);
		expect(html).toContain("empty-state");
		expect(html).toContain("No pages or panels configured");
	});

	it("shows page navigation links when pages exist", () => {
		const pages = [
			definePage({ id: "p1", title: "Page One" }),
			definePage({ id: "p2", title: "Page Two", path: "/custom-path" }),
		];
		const html = renderIndexPageBody(pages, [], mockState);
		expect(html).toContain("page-nav");
		expect(html).toContain('href="/pages/p1"');
		expect(html).toContain(">Page One<");
		expect(html).toContain('href="/custom-path"');
		expect(html).toContain(">Page Two<");
	});

	it("shows panel grid when overview panels exist", () => {
		const panels = [definePanel({ id: "status", title: "Status", render: () => "<p>ok</p>" })];
		const html = renderIndexPageBody([], panels, mockState);
		expect(html).toContain("panel-grid");
		expect(html).toContain("ok");
		expect(html).toContain("Status");
	});

	it("shows both nav and panels when both exist", () => {
		const pages = [definePage({ id: "p1", title: "Page One" })];
		const panels = [definePanel({ id: "status", title: "Status", render: () => "<p>ok</p>" })];
		const html = renderIndexPageBody(pages, panels, mockState);
		expect(html).toContain("page-nav");
		expect(html).toContain("panel-grid");
	});

	it("escapes page titles in navigation", () => {
		const pages = [definePage({ id: "xss", title: "<script>alert(1)</script>" })];
		const html = renderIndexPageBody(pages, [], mockState);
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<script>alert");
	});

	it("does not show page-nav section when no pages provided", () => {
		const panels = [definePanel({ id: "p", title: "P", render: () => "content" })];
		const html = renderIndexPageBody([], panels, mockState);
		expect(html).not.toContain("page-nav");
	});
});
