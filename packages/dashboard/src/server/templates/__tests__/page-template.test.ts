import { describe, expect, it } from "vitest";
import { definePage } from "../../../dashboard-page.js";
import { definePanel } from "../../../dashboard-panel.js";
import { collectAllPanels } from "../page-template.js";

const panelA = definePanel({ id: "a", title: "A", render: () => "" });
const panelB = definePanel({ id: "b", title: "B", render: () => "" });
const panelC = definePanel({ id: "c", title: "C", render: () => "" });

describe("collectAllPanels", () => {
	it("returns an empty array when given no pages or panels", () => {
		expect(collectAllPanels([], [])).toEqual([]);
	});

	it("collects panels from pages", () => {
		const page = definePage({ id: "p1", title: "P1", panels: [panelA, panelB] });
		expect(collectAllPanels([page], [])).toEqual([panelA, panelB]);
	});

	it("collects overview panels", () => {
		expect(collectAllPanels([], [panelA, panelB])).toEqual([panelA, panelB]);
	});

	it("deduplicates panels that appear in both pages and overview", () => {
		const page = definePage({ id: "p1", title: "P1", panels: [panelA] });
		const result = collectAllPanels([page], [panelA, panelB]);
		expect(result).toHaveLength(2);
		expect(result).toContain(panelA);
		expect(result).toContain(panelB);
	});

	it("deduplicates panels that appear in multiple pages", () => {
		const page1 = definePage({ id: "p1", title: "P1", panels: [panelA, panelB] });
		const page2 = definePage({ id: "p2", title: "P2", panels: [panelB, panelC] });
		const result = collectAllPanels([page1, page2], []);
		expect(result).toHaveLength(3);
	});

	it("preserves first-seen order", () => {
		const page = definePage({ id: "p1", title: "P1", panels: [panelA, panelB] });
		const result = collectAllPanels([page], [panelC]);
		expect(result).toEqual([panelA, panelB, panelC]);
	});
});
