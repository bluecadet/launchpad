import { beforeEach, describe, expect, it } from "vitest";
import {
	type ContributedPage,
	type ContributedPanel,
	DashboardRegistry,
	registry,
} from "../panel-registry.js";

const makePanel = (id: string): ContributedPanel => ({
	id,
	title: id.toUpperCase(),
	render: () => "",
});

const makePage = (id: string): ContributedPage => ({
	id,
	title: id.toUpperCase(),
	render: () => "",
});

describe("panel-registry", () => {
	beforeEach(() => {
		registry.reset();
	});

	describe("getPanels / getPages / getScripts / getStyles — initial state", () => {
		it("returns empty arrays initially", () => {
			const r = new DashboardRegistry();
			expect(r.getPanels()).toEqual([]);
			expect(r.getPages()).toEqual([]);
			expect(r.getScripts()).toEqual([]);
			expect(r.getStyles()).toEqual([]);
		});
	});

	describe("contributePanel", () => {
		it("adds a single panel", () => {
			const panel = makePanel("status");
			registry.contributePanel(panel);
			expect(registry.getPanels()).toEqual([panel]);
		});

		it("adds multiple panels in a single call", () => {
			const a = makePanel("alpha");
			const b = makePanel("beta");
			registry.contributePanel(a, b);
			expect(registry.getPanels()).toEqual([a, b]);
		});

		it("accumulates panels across multiple calls", () => {
			const a = makePanel("first");
			const b = makePanel("second");
			registry.contributePanel(a);
			registry.contributePanel(b);
			expect(registry.getPanels()).toEqual([a, b]);
		});
	});

	describe("contributePage", () => {
		it("adds a single page", () => {
			const page = makePage("home");
			registry.contributePage(page);
			expect(registry.getPages()).toEqual([page]);
		});

		it("adds multiple pages in a single call", () => {
			const a = makePage("home");
			const b = makePage("settings");
			registry.contributePage(a, b);
			expect(registry.getPages()).toEqual([a, b]);
		});

		it("accumulates pages across multiple calls", () => {
			const a = makePage("first");
			const b = makePage("second");
			registry.contributePage(a);
			registry.contributePage(b);
			expect(registry.getPages()).toEqual([a, b]);
		});
	});

	describe("contributeScript", () => {
		it("adds a script with auto-generated url", () => {
			registry.contributeScript("/abs/path/htmx.min.js", { defer: true });
			const scripts = registry.getScripts();
			expect(scripts).toHaveLength(1);
			expect(scripts[0]?.filePath).toBe("/abs/path/htmx.min.js");
			expect(scripts[0]?.url).toMatch(/^\/assets\/htmx\.min-[0-9a-f]{8}\.js$/);
			expect(scripts[0]?.defer).toBe(true);
		});

		it("deduplicates by filePath", () => {
			registry.contributeScript("/abs/path/htmx.min.js", { defer: true });
			registry.contributeScript("/abs/path/htmx.min.js", { defer: true });
			expect(registry.getScripts()).toHaveLength(1);
		});

		it("preserves order of first contribution", () => {
			registry.contributeScript("/abs/a.js");
			registry.contributeScript("/abs/b.js");
			registry.contributeScript("/abs/a.js"); // duplicate, ignored
			expect(registry.getScripts().map((s) => s.filePath)).toEqual(["/abs/a.js", "/abs/b.js"]);
		});

		it("generates different urls for different file paths with the same basename", () => {
			registry.contributeScript("/pkg-a/lib/utils.js");
			registry.contributeScript("/pkg-b/lib/utils.js");
			const [a, b] = registry.getScripts();
			expect(a?.url).not.toBe(b?.url);
		});
	});

	describe("contributeStyle", () => {
		it("adds a stylesheet with auto-generated url", () => {
			registry.contributeStyle("/abs/path/dashboard.css");
			const styles = registry.getStyles();
			expect(styles).toHaveLength(1);
			expect(styles[0]?.filePath).toBe("/abs/path/dashboard.css");
			expect(styles[0]?.url).toMatch(/^\/assets\/dashboard-[0-9a-f]{8}\.css$/);
		});

		it("deduplicates by filePath", () => {
			registry.contributeStyle("/abs/path/dashboard.css");
			registry.contributeStyle("/abs/path/dashboard.css");
			expect(registry.getStyles()).toHaveLength(1);
		});
	});

	describe("reset", () => {
		it("clears all contribution types", () => {
			registry.contributePanel(makePanel("p1"));
			registry.contributePage(makePage("pg1"));
			registry.contributeScript("/abs/a.js");
			registry.contributeStyle("/abs/a.css");
			registry.reset();
			expect(registry.getPanels()).toEqual([]);
			expect(registry.getPages()).toEqual([]);
			expect(registry.getScripts()).toEqual([]);
			expect(registry.getStyles()).toEqual([]);
		});
	});

	describe("DashboardRegistry instances are isolated", () => {
		it("separate instances do not share state", () => {
			const r1 = new DashboardRegistry();
			const r2 = new DashboardRegistry();
			r1.contributePanel(makePanel("x"));
			expect(r2.getPanels()).toHaveLength(0);
		});
	});

	describe("isolation between tests", () => {
		it("does not see contributions from other tests (part 1)", () => {
			registry.contributePanel(makePanel("isolation-test"));
			expect(registry.getPanels()).toHaveLength(1);
		});

		it("does not see contributions from other tests (part 2)", () => {
			expect(registry.getPanels()).toHaveLength(0);
		});
	});
});
