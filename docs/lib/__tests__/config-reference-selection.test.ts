import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	type ConfigReferenceRow,
	getConfigReferenceRows,
	selectConfigReferenceRows,
} from "../config-reference.js";

const rows = getConfigReferenceRows(
	z.object({
		apps: z.array(
			z.object({
				pm2: z.object({ enabled: z.boolean(), env: z.object({ name: z.string() }) }),
				pm2Extra: z.string(),
			}),
		),
		appsExtra: z.string(),
		resource: z.record(z.string(), z.object({ url: z.string(), timeout: z.number() })),
		resources: z.string(),
	}),
);

function names(selected: readonly ConfigReferenceRow[]): string[] {
	return selected.map((row) => row.name);
}

describe("selectConfigReferenceRows", () => {
	it("retains all rows for the id-only fallback", () => {
		expect(selectConfigReferenceRows(rows)).toBe(rows);
		expect(selectConfigReferenceRows(rows, { includeChildren: false })).toBe(rows);
	});

	it("selects the exact row by default, preserving its metadata and description", () => {
		const selected = selectConfigReferenceRows(rows, { property: "apps[].pm2" });
		expect(selected).toEqual([rows.find((row) => row.name === "apps[].pm2")]);
		expect(selected[0]).toBe(rows[1]);
	});

	it("includes ordered descendants at dot and bracket boundaries, not prefix collisions", () => {
		expect(
			names(selectConfigReferenceRows(rows, { property: "apps", includeChildren: true })),
		).toEqual([
			"apps",
			"apps[].pm2",
			"apps[].pm2.enabled",
			"apps[].pm2.env",
			"apps[].pm2.env.name",
			"apps[].pm2Extra",
		]);
		expect(
			names(selectConfigReferenceRows(rows, { property: "apps[].pm2", includeChildren: true })),
		).toEqual(["apps[].pm2", "apps[].pm2.enabled", "apps[].pm2.env", "apps[].pm2.env.name"]);
		expect(
			names(selectConfigReferenceRows(rows, { property: "resource", includeChildren: true })),
		).toEqual(["resource", "resource[key]", "resource[key].url", "resource[key].timeout"]);
		expect(
			names(selectConfigReferenceRows(rows, { property: "resource[key]", includeChildren: true })),
		).toEqual(["resource[key]", "resource[key].url", "resource[key].timeout"]);
	});

	it("puts the selected row first and retains descendant source order without mutating rows", () => {
		const reordered = [rows[2], rows[1], rows[0]].filter((row) => row !== undefined);
		const original = [...reordered];
		expect(
			names(selectConfigReferenceRows(reordered, { property: "apps", includeChildren: true })),
		).toEqual(["apps", "apps[].pm2.enabled", "apps[].pm2"]);
		expect(reordered).toEqual(original);
	});

	it("excludes complete descendant subtrees using exact full paths", () => {
		expect(
			names(
				selectConfigReferenceRows(rows, {
					property: "apps",
					includeChildren: true,
					exclude: ["apps[].pm2"],
				}),
			),
		).toEqual(["apps", "apps[].pm2Extra"]);
		expect(
			names(
				selectConfigReferenceRows(rows, {
					property: "apps[].pm2",
					includeChildren: true,
					exclude: ["apps[].pm2.env", "apps[].pm2.enabled"],
				}),
			),
		).toEqual(["apps[].pm2"]);
		expect(
			names(
				selectConfigReferenceRows(rows, {
					property: "resource",
					includeChildren: true,
					exclude: ["resource[key]"],
				}),
			),
		).toEqual(["resource"]);
	});

	it.each([
		z.string().describe("Root scalar."),
		z.array(z.object({ enabled: z.boolean() })).describe("Root array."),
		z.record(z.string(), z.object({ enabled: z.boolean() })).describe("Root record."),
	])("selects the synthetic (root) row and its unprefixed children", (schema) => {
		const rootRows = getConfigReferenceRows(schema);
		expect(selectConfigReferenceRows(rootRows, { property: "(root)" })).toEqual([rootRows[0]]);
		expect(
			selectConfigReferenceRows(rootRows, { property: "(root)", includeChildren: true }),
		).toEqual(rootRows);
	});

	it("treats a property called root as an ordinary path, not the synthetic (root)", () => {
		const rootRows = getConfigReferenceRows(
			z.object({ root: z.object({ enabled: z.boolean() }), sibling: z.string() }),
		);
		expect(
			names(selectConfigReferenceRows(rootRows, { property: "root", includeChildren: true })),
		).toEqual(["root", "root.enabled"]);
		expect(() => selectConfigReferenceRows(rootRows, { property: "(root)" })).toThrow(
			"Unknown configuration property: (root)",
		);
	});

	it("excludes descendants of the synthetic root", () => {
		const rootRows = getConfigReferenceRows(
			z.record(z.string(), z.object({ enabled: z.boolean() })),
		);
		expect(
			names(
				selectConfigReferenceRows(rootRows, {
					property: "(root)",
					includeChildren: true,
					exclude: ["[key]"],
				}),
			),
		).toEqual(["(root)"]);
	});

	it.each(["missing", "app", "apps[]", "root", "(root)", ""])(
		"rejects unknown property %s rather than matching a prefix or inventing a root",
		(property) => {
			expect(() => selectConfigReferenceRows(rows, { property })).toThrow(
				`Unknown configuration property: ${property}`,
			);
		},
	);

	it.each([{ exclude: [] }, { exclude: ["apps[].pm2"] }])(
		"rejects exclusions without a property: %j",
		({ exclude }) => {
			expect(() => selectConfigReferenceRows(rows, { includeChildren: true, exclude })).toThrow(
				"Configuration exclusions require a property",
			);
		},
	);

	it.each([undefined, false])("requires includeChildren for exclusions (%s)", (includeChildren) => {
		expect(() =>
			selectConfigReferenceRows(rows, { property: "apps", includeChildren, exclude: [] }),
		).toThrow("Configuration exclusions require includeChildren");
	});

	it.each(["apps", "appsExtra", "resource[key]", "apps[].missing", "pm2", "apps[]", ""])(
		"rejects exclusion %s that is not an existing descendant",
		(path) => {
			expect(() =>
				selectConfigReferenceRows(rows, {
					property: "apps",
					includeChildren: true,
					exclude: [path],
				}),
			).toThrow(`Invalid configuration exclusion: ${path} is not a descendant of apps`);
		},
	);

	it("respects rows extracted with nested: false rather than traversing missing children", () => {
		const shallowRows = getConfigReferenceRows(z.object({ app: z.object({ name: z.string() }) }), {
			nested: false,
		});
		expect(
			names(selectConfigReferenceRows(shallowRows, { property: "app", includeChildren: true })),
		).toEqual(["app"]);
		expect(() => selectConfigReferenceRows(shallowRows, { property: "app.name" })).toThrow(
			"Unknown configuration property: app.name",
		);
		expect(() =>
			selectConfigReferenceRows(shallowRows, {
				property: "app",
				includeChildren: true,
				exclude: ["app.name"],
			}),
		).toThrow("Invalid configuration exclusion: app.name is not a descendant of app");
	});
});
