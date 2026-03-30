import type { Patch } from "@bluecadet/launchpad-utils/state-patcher";
import { describe, expect, it } from "vitest";
import { createTrackingProxy, isPanelAffected } from "../state-tracker.js";

describe("createTrackingProxy", () => {
	it("records top-level property access", () => {
		const state = { foo: 1, bar: 2 };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.foo;
		expect(accessed.has("foo")).toBe(true);
		expect(accessed.has("bar")).toBe(false);
	});

	it("records only the leaf path for nested property access", () => {
		const state = { a: { b: { c: 42 } } };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.a.b.c;
		// Intermediate traversal nodes are pruned; only the leaf is kept.
		expect(accessed.has("a")).toBe(false);
		expect(accessed.has("a\x1Fb")).toBe(false);
		expect(accessed.has("a\x1Fb\x1Fc")).toBe(true);
	});

	it("records top-level prop as leaf when not traversed deeper", () => {
		const state = { a: { b: 1 }, c: 2 };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.c; // leaf: primitive, no children
		expect(accessed.has("c")).toBe(true);
	});

	it("tracks sibling leaf paths independently", () => {
		const state = { plugins: { content: { status: "ok" }, monitor: { fps: 60 } } };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.plugins.content.status;
		void proxy.plugins.monitor.fps;
		expect(accessed.has("plugins")).toBe(false);
		expect(accessed.has("plugins\x1Fcontent")).toBe(false);
		expect(accessed.has("plugins\x1Fcontent\x1Fstatus")).toBe(true);
		expect(accessed.has("plugins\x1Fmonitor\x1Ffps")).toBe(true);
	});

	it("does not proxy Date instances", () => {
		const date = new Date();
		const state = { ts: date };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		const result = proxy.ts;
		expect(result).toBe(date);
		// "ts" should be recorded but no sub-paths like "ts\x1FgetTime"
		expect(accessed.has("ts")).toBe(true);
		const subPaths = Array.from(accessed).filter((k) => k.startsWith("ts\x1F"));
		expect(subPaths).toHaveLength(0);
	});

	it("does not record symbol access", () => {
		const state = { x: 1 };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void (proxy as unknown as Record<symbol, unknown>)[Symbol.iterator];
		expect(accessed.size).toBe(0);
	});

	it("deduplicates repeated access to the same path", () => {
		const state = { n: 5 };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.n;
		void proxy.n;
		void proxy.n;
		expect(accessed.size).toBe(1);
	});

	it("records array element access as leaf, not parent array", () => {
		const state = { list: ["a", "b", "c"] };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.list[1];
		expect(accessed.has("list")).toBe(false);
		expect(accessed.has("list\x1F1")).toBe(true);
	});

	it("records array as leaf when accessed without drilling into elements", () => {
		const state = { list: [1, 2, 3] };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.list;
		expect(accessed.has("list")).toBe(true);
	});

	it("proxies plain objects with null prototype", () => {
		const inner = Object.create(null) as Record<string, number>;
		inner.x = 99;
		const state = { obj: inner };
		const accessed = new Set<string>();
		const proxy = createTrackingProxy(state, accessed);
		void proxy.obj.x;
		expect(accessed.has("obj\x1Fx")).toBe(true);
	});
});

describe("isPanelAffected", () => {
	it("returns true on exact path match", () => {
		const deps = new Set(["a\x1Fb"]);
		const patches = [{ op: "replace" as const, path: ["a", "b"], value: 1 }];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});

	it("returns true when patch path is a prefix of dep (parent replaced)", () => {
		const deps = new Set(["a\x1Fb\x1Fc"]);
		const patches = [{ op: "replace" as const, path: ["a", "b"], value: {} }];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});

	it("returns true when dep is a prefix of patch path (child changed)", () => {
		const deps = new Set(["a"]);
		const patches = [{ op: "replace" as const, path: ["a", "b", "c"], value: 1 }];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});

	it("returns false for sibling paths", () => {
		const deps = new Set(["a\x1Fb"]);
		const patches = [{ op: "replace" as const, path: ["a", "c"], value: 1 }];
		expect(isPanelAffected(deps, patches)).toBe(false);
	});

	it("returns false for completely unrelated top-level paths", () => {
		const deps = new Set(["foo"]);
		const patches = [{ op: "replace" as const, path: ["bar"], value: 1 }];
		expect(isPanelAffected(deps, patches)).toBe(false);
	});

	it("returns false for empty deps", () => {
		const deps = new Set<string>();
		const patches = [{ op: "replace" as const, path: ["a", "b"], value: 1 }];
		expect(isPanelAffected(deps, patches)).toBe(false);
	});

	it("returns false for empty patches", () => {
		const deps = new Set(["a\x1Fb"]);
		const patches: Patch[] = [];
		expect(isPanelAffected(deps, patches)).toBe(false);
	});

	it("returns true when any one of multiple patches matches", () => {
		const deps = new Set(["a\x1Fb"]);
		const patches = [
			{ op: "replace" as const, path: ["x", "y"], value: 1 },
			{ op: "replace" as const, path: ["a", "b"], value: 2 },
		];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});

	it("returns false when no patch in a multi-patch list matches", () => {
		const deps = new Set(["a\x1Fb"]);
		const patches = [
			{ op: "replace" as const, path: ["x", "y"], value: 1 },
			{ op: "replace" as const, path: ["a", "c"], value: 2 },
		];
		expect(isPanelAffected(deps, patches)).toBe(false);
	});

	it("returns true when any dep in a multi-dep set matches", () => {
		const deps = new Set(["x\x1Fy", "a\x1Fb"]);
		const patches = [{ op: "replace" as const, path: ["a", "b"], value: 1 }];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});

	// Regression: panels sharing a common ancestor (e.g. plugins.content vs plugins.monitor)
	// must not cross-trigger each other. With leaf-only dep tracking, "plugins" is pruned
	// so only the specific sibling path is checked.
	it("does not affect a panel whose sibling subtree changed", () => {
		const deps = new Set(["plugins\x1Fcontent\x1Fstatus"]);
		const patches = [{ op: "replace" as const, path: ["plugins", "monitor", "fps"], value: 60 }];
		expect(isPanelAffected(deps, patches)).toBe(false);
	});

	it("does affect a panel when its own subtree changes", () => {
		const deps = new Set(["plugins\x1Fcontent\x1Fstatus"]);
		const patches = [
			{ op: "replace" as const, path: ["plugins", "content", "status"], value: "loaded" },
		];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});

	// Regression: immer uses numeric indices for array patches; keyToPath returns
	// strings, so the comparison must be type-agnostic.
	it("returns true when patch path has numeric array index matching dep", () => {
		const deps = new Set(["list\x1F0"]);
		const patches = [{ op: "replace" as const, path: ["list", 0], value: "updated" }];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});

	it("returns false when numeric array index does not match dep index", () => {
		const deps = new Set(["list\x1F1"]);
		const patches = [{ op: "replace" as const, path: ["list", 0], value: "updated" }];
		expect(isPanelAffected(deps, patches)).toBe(false);
	});

	it("returns true when dep is parent array and numeric-indexed child changes", () => {
		const deps = new Set(["list"]);
		const patches = [{ op: "replace" as const, path: ["list", 2], value: "updated" }];
		expect(isPanelAffected(deps, patches)).toBe(true);
	});
});
