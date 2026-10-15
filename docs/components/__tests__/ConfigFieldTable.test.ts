import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";
import ConfigFieldTable from "../ConfigFieldTable.astro";
import ConfigReference from "../ConfigReference.astro";

// Shared setup mocks fs; stylesheet contracts must be read from the real checkout.
const { readFileSync } = await vi.importActual<typeof import("node:fs")>("node:fs");

vi.mock("../../lib/config-references.js", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../lib/config-references.js")>();
	const { z } = await import("zod");
	return {
		...original,
		configReferences: [
			...original.configReferences,
			{
				id: "table-fixture",
				schema: z.object({
					settings: z.object({
						"<img src=x>": z
							.custom()
							.meta({ configDocs: { inputType: "<Type> | string\nnext" } })
							.describe("<script>alert(1)</script> & **literal**\nnext"),
						zero: z.number().default(0),
						disabled: z.boolean().default(false),
						nullable: z.string().nullable().default(null),
						empty: z.string().default(""),
						emptyLabel: z.string().meta({ configDocs: { defaultLabel: "" } }),
						unsafe: z.string().default("<svg onload=alert(1)>"),
						nested: z.object({ enabled: z.boolean() }),
					}),
				}),
			},
		],
	};
});

function tableRows(html: string): string[][] {
	const body = html.match(/<tbody\b[^>]*>(.*?)<\/tbody>/s)?.[1] ?? "";
	return [...body.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)].map((row) =>
		[...(row[1] ?? "").matchAll(/<(?:th|td)\b[^>]*>(.*?)<\/(?:th|td)>/gs)].map(
			(cell) => cell[1]?.replace(/<code\b[^>]*>(.*?)<\/code>/s, "$1") ?? "",
		),
	);
}

describe("ConfigFieldTable", () => {
	it("renders accessible, escaped plain-text fields and exact input defaults without hydration", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigFieldTable, {
			props: {
				id: "table-fixture",
				property: "settings",
				caption: "<Object> fields",
				exclude: ["settings.nested"],
			},
		});
		const rows = tableRows(html);
		expect(rows[0]).toEqual([
			"&lt;img src=x&gt;",
			"&lt;Type&gt; | string\nnext",
			"Yes",
			"—",
			"&lt;script&gt;alert(1)&lt;/script&gt; &amp; **literal**\nnext",
		]);
		expect(rows.slice(1).map((row) => row.slice(0, 4))).toEqual([
			["zero", "number", "No", "0"],
			["disabled", "boolean", "No", "false"],
			["nullable", "string | null", "No", "null"],
			["empty", "string", "No", "&quot;&quot;"],
			["emptyLabel", "string", "Yes", ""],
			["unsafe", "string", "No", "&quot;&lt;svg onload=alert(1)&gt;&quot;"],
		]);
		expect(html).toMatch(/<caption\b[^>]*>&lt;Object&gt; fields<\/caption>/);
		expect([...html.matchAll(/scope="col"/g)]).toHaveLength(5);
		expect([...html.matchAll(/scope="row"/g)]).toHaveLength(rows.length);
		expect(html).not.toMatch(/<(?:h[1-6]|dl|script|img|svg|astro-island|astro-server-island)\b/);
		expect(html).not.toContain("settings.");
	});

	it("preserves identifier case and tracking without overriding the framework's card layout", () => {
		const source = readFileSync(new URL("../ConfigFieldTable.astro", import.meta.url), "utf8");
		const styles = source.split("<style>")[1] ?? "";
		const rowHeader = styles.match(/\.config-field-table th\[scope="row"\]\s*\{([^}]+)\}/)?.[1];
		expect(rowHeader).toMatch(/text-transform:\s*none;/);
		expect(rowHeader).toMatch(/letter-spacing:\s*normal;/);
		expect(styles).toMatch(
			/@media \(max-width: 767px\)\s*\{\s*\.config-field-table th\[scope="row"\]\s*\{\s*display: block;/,
		);
		// The table wrapper and cells use article.css's responsive behavior, not a parallel layout.
		expect(styles).not.toMatch(/overflow-x:|\btd\s*\{|\btable\s*\{/);
	});

	it("keeps a semantic caption visually hidden without spacing in desktop or mobile layouts", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigFieldTable, {
			props: { id: "content-options", property: "versioning", caption: "Versioning fields" },
		});
		expect(html).toMatch(/<table\b[^>]*>\s*<caption\b[^>]*>Versioning fields<\/caption>/);
		expect(html).toContain('role="region" aria-label="Versioning fields"');
		expect(html).not.toMatch(/aria-hidden=|\shidden(?:\s|=|>)/);

		const source = readFileSync(new URL("../ConfigFieldTable.astro", import.meta.url), "utf8");
		const styles = source.split("<style>")[1] ?? "";
		const [desktop = "", mobile = ""] = styles.split("@media (max-width: 767px)");
		const caption = desktop.match(/\.config-field-table caption\s*\{([^}]+)\}/)?.[1];
		expect(caption).toMatch(/position:\s*absolute;/);
		expect(caption).toMatch(/inline-size:\s*1px;/);
		expect(caption).toMatch(/block-size:\s*1px;/);
		expect(caption).toMatch(/padding:\s*0;/);
		expect(caption).toMatch(/margin:\s*-1px;/);
		expect(caption).toMatch(/overflow:\s*hidden;/);
		expect(caption).toMatch(/clip-path:\s*inset\(50%\);/);
		expect(caption).toMatch(/white-space:\s*nowrap;/);
		expect(caption).toMatch(/border:\s*0;/);
		expect(caption).not.toMatch(/display:\s*none|visibility:\s*hidden/);
		expect(mobile).not.toContain("caption");
	});

	it("keeps the versioning parent input default separate from its object-field defaults", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: "content-options", property: "versioning" },
		});
		expect(html).toMatch(/Input default:<\/strong> <code\b[^>]*>false<\/code>/);
		expect(html).not.toContain("keepVersions");
		expect(html).not.toContain("ackTimeout");
	});

	it.each([
		{
			id: "content-options",
			property: "versioning",
			fields: [
				["keepVersions", "number", "No", "3"],
				["ackTimeout", "string | number", "No", "&quot;30m&quot;"],
			],
		},
		{
			id: "content-options",
			property: "sources",
			fields: [
				["id", "string", "Yes", "—"],
				["fetch", "ContentSource[&quot;fetch&quot;]", "Yes", "—"],
			],
		},
		{
			id: "monitor-options",
			property: "apps[].pm2",
			fields: [
				["out_file", "string", "No", "—"],
				["error_file", "string", "No", "—"],
			],
		},
		{
			id: "scheduler-options",
			property: "retry.backoff",
			fields: [
				["initial", "string | number", "No", "—"],
				["max", "string | number", "No", "—"],
				["factor", "number", "No", "—"],
			],
		},
	])(
		"renders the schema-backed $property shape with local names",
		async ({ id, property, fields }) => {
			const container = await AstroContainer.create();
			const html = await container.renderToString(ConfigFieldTable, {
				props: { id, property, caption: "Fields" },
			});
			expect(tableRows(html).map((row) => row.slice(0, 4))).toEqual(fields);
			expect(html).toMatch(/<div\b[^>]*class="table-wrap config-field-table"/);
			const headings = [...html.matchAll(/<th\b[^>]*scope="col"[^>]*>(.*?)<\/th>/gs)].map(
				(match) => match[1],
			);
			const labels = [...html.matchAll(/<td\b([^>]*)>/g)].map(
				(match) => match[1]?.match(/\bdata-label="([^"]+)"/)?.[1],
			);
			// Every mobile card value retains its column label after the framework hides thead.
			expect(labels).toEqual(fields.flatMap(() => headings.slice(1)));
		},
	);

	it.each([
		{ id: "missing", property: "settings", message: /Unknown configuration reference/ },
		{ id: "table-fixture", property: "missing", message: /Unknown configuration property/ },
		{ id: "table-fixture", property: "settings.zero", message: /No configuration fields/ },
		{ id: "table-fixture", property: "settings", message: /Nested configuration field/ },
	])("rejects invalid or deeper table selection $property", async ({ id, property, message }) => {
		const container = await AstroContainer.create();
		await expect(
			container.renderToString(ConfigFieldTable, { props: { id, property, caption: "Fields" } }),
		).rejects.toThrow(message);
	});
});
