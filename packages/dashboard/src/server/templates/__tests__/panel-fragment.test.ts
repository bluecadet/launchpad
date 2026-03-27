import type { VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import { describe, expect, it } from "vitest";
import { definePanel } from "../../../dashboard-panel.js";
import { renderPanelFragment } from "../panel-fragment.js";

const mockState: VersionedLaunchpadState = {
	system: { startTime: new Date(), mode: "task" },
	plugins: {},
	_version: 0,
};

describe("renderPanelFragment", () => {
	it("returns the output of the panel render function", () => {
		const panel = definePanel({
			id: "test",
			title: "Test",
			render: () => "<p>hello</p>",
		});
		expect(renderPanelFragment(panel, mockState)).toBe("<p>hello</p>");
	});

	it("passes the state to the render function", () => {
		const panel = definePanel({
			id: "test",
			title: "Test",
			render: (state) => `<p>${state.system.mode}</p>`,
		});
		expect(renderPanelFragment(panel, mockState)).toBe("<p>task</p>");
	});

	it("passes ui helpers to the render function", () => {
		const panel = definePanel({
			id: "test",
			title: "Test",
			render: (_state, { ui }) => ui.statusBadge("OK", "success"),
		});
		expect(renderPanelFragment(panel, mockState)).toContain("badge--success");
	});

	it("catches render errors and returns an error fragment instead of throwing", () => {
		const panel = definePanel({
			id: "broken",
			title: "Broken",
			render: () => {
				throw new Error("render failed");
			},
		});
		const result = renderPanelFragment(panel, mockState);
		expect(result).toContain("render failed");
		expect(result).toContain("broken");
		expect(result).toContain("panel-error");
	});

	it("handles non-Error throws in render", () => {
		const panel = definePanel({
			id: "broken",
			title: "Broken",
			render: () => {
				throw "string error";
			},
		});
		const result = renderPanelFragment(panel, mockState);
		expect(result).toContain("string error");
	});

	it("escapes the panel id in the error fragment to prevent injection", () => {
		const panel = definePanel({
			id: 'x"><script>',
			title: "Bad ID",
			render: () => {
				throw new Error("oops");
			},
		});
		const result = renderPanelFragment(panel, mockState);
		expect(result).not.toContain("<script>");
		expect(result).toContain("&lt;script&gt;");
	});
});
