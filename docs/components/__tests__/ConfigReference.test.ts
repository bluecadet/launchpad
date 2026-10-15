import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";
import ConfigReference from "../ConfigReference.astro";

const fixture = vi.hoisted(() => ({
	id: "unsafe-fixture",
	name: "<img src=x onerror=alert(1)> | option\nnext",
	type: "<iframe src=javascript:alert(2)> | type\nnext",
	defaultValue: "<svg onload=alert(3)> | default\nnext",
	description: "<script>alert(4)</script> & | description\nnext",
	longName: `option${"x".repeat(200)}\nnext`,
	longType: `Type${"x".repeat(200)}\nnext`,
	longDefault: `default${"x".repeat(200)}\nnext`,
}));

vi.mock("../../lib/config-references.js", async () => {
	const { z } = await import("zod");
	return {
		configReferences: [
			{
				id: fixture.id,
				schema: z.object({
					["__proto__"]: z
						.custom()
						.meta({ configDocs: { inputType: fixture.type } })
						.describe(fixture.description),
					[fixture.name]: z.string().default(fixture.defaultValue),
				}),
			},
			{
				id: "nested-fixture",
				schema: z.object({
					apps: z.array(
						z.object({
							pm2: z
								.object({
									enabled: z.boolean().default(false).describe("Enable process management."),
									env: z.object({ name: z.string() }).describe("Process environment."),
								})
								.describe("Schema-owned process settings."),
							pm2Extra: z.string().describe("Separate setting."),
						}),
					),
				}),
			},
			{
				id: "root-fixture",
				schema: z
					.record(z.string(), z.object({ enabled: z.boolean().describe("Enable a resource.") }))
					.describe("Schema-owned root description."),
			},
			{
				id: "shallow-fixture",
				nested: false,
				schema: z.object({ app: z.object({ enabled: z.boolean() }) }),
			},
			{
				id: "defaults-fixture",
				schema: z.object({
					zero: z.number().default(0),
					disabled: z.boolean().default(false),
					nullable: z.string().nullable().default(null),
					emptyString: z.string().default(""),
					emptyLabel: z.string().meta({ configDocs: { defaultLabel: "" } }),
					absent: z.string().optional(),
					[fixture.longName]: z.string().meta({
						configDocs: { inputType: fixture.longType, defaultLabel: fixture.longDefault },
					}),
				}),
			},
		],
	};
});

function codeText(html: string | undefined): string | undefined {
	return html?.match(/^<code\b[^>]*>(.*?)<\/code>$/s)?.[1];
}

function properties(html: string) {
	expect([...html.matchAll(/<dl\b/g)]).toHaveLength(1);
	const list = html.match(/<dl\b[^>]*>(.*?)<\/dl>/s)?.[1];
	expect(list).toBeDefined();
	const entries = [
		...(list ?? "").matchAll(
			/<div\b[^>]*>\s*<dt\b[^>]*>(.*?)<\/dt>\s*<dd\b[^>]*>(.*?)<\/dd>\s*<\/div>/gs,
		),
	].map((match) => ({
		name: codeText(match[1]),
		paragraphs: [...(match[2] ?? "").matchAll(/<p\b[^>]*>(.*?)<\/p>/gs)].map(
			(paragraph) => paragraph[1] ?? "",
		),
	}));
	expect([...html.matchAll(/<dt\b/g)]).toHaveLength(entries.length);
	expect([...html.matchAll(/<dd\b/g)]).toHaveLength(entries.length);
	for (const { paragraphs } of entries) {
		expect(paragraphs).toHaveLength(4);
		expect(
			paragraphs.map((paragraph) => paragraph.match(/^<strong\b[^>]*>(.*?)<\/strong>/)?.[1]),
		).toEqual(["Input type:", "Required:", "Input default:", undefined]);
		expect(paragraphs[1]).toMatch(/<\/strong> (?:Yes|No)$/);
	}
	expectStaticMarkup(html);
	return entries;
}

function expectStaticMarkup(html: string): void {
	expect(html).not.toMatch(
		/<(?:table|thead|tbody|tr|th|td|h[1-6]|a|astro-island|astro-server-island|script)\b/i,
	);
	expect(html).not.toContain("table-wrap");
}

function selectedParagraphs(html: string): string[] {
	const metadata = html.split(/<dl\b/)[0] ?? "";
	return [...metadata.matchAll(/<p\b[^>]*>(.*?)<\/p>/gs)].map((match) => match[1] ?? "");
}

function metadataValue(paragraph: string | undefined): string | undefined {
	return paragraph?.replace(/^<strong\b[^>]*>.*?<\/strong> /s, "");
}

describe("ConfigReference", () => {
	it("renders escaped, ordered vertical property definitions without headings or hydration", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, { props: { id: fixture.id } });
		const entries = properties(html);

		expect(entries).toHaveLength(2);
		expect(entries[0]?.name).toBe("__proto__");
		expect(entries[1]?.name).toBe("&lt;img src=x onerror=alert(1)&gt; | option\nnext");
		const required = entries[0]?.paragraphs ?? [];
		const optional = entries[1]?.paragraphs ?? [];
		// Text nodes preserve pipes and newlines; schema text is never interpreted as HTML.
		expect(codeText(metadataValue(required[0]))).toBe(
			"&lt;iframe src=javascript:alert(2)&gt; | type\nnext",
		);
		expect(metadataValue(required[1])).toBe("Yes");
		expect(metadataValue(required[2])).toBe("—");
		expect(required[3]).toBe("&lt;script&gt;alert(4)&lt;/script&gt; &amp; | description\nnext");
		expect(codeText(metadataValue(optional[0]))).toBe("string");
		expect(metadataValue(optional[1])).toBe("No");
		expect(codeText(metadataValue(optional[2]))).toBe(
			"&quot;&lt;svg onload=alert(3)&gt; | default\\nnext&quot;",
		);
		expect(optional[3]).toBe("");
		expect(html).not.toMatch(/<(?:img|iframe|svg)\b/i);
	});

	it("preserves falsy, empty, absent, multiline, and long input defaults and types", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: "defaults-fixture" },
		});
		const entries = properties(html);

		expect(entries.map((entry) => entry.name)).toEqual([
			"zero",
			"disabled",
			"nullable",
			"emptyString",
			"emptyLabel",
			"absent",
			fixture.longName,
		]);
		expect(entries.map((entry) => codeText(metadataValue(entry.paragraphs[0])))).toEqual([
			"number",
			"boolean",
			"string | null",
			"string",
			"string",
			"string",
			fixture.longType,
		]);
		expect(entries.map((entry) => metadataValue(entry.paragraphs[1]))).toEqual([
			"No",
			"No",
			"No",
			"No",
			"Yes",
			"No",
			"Yes",
		]);
		expect(entries.map((entry) => codeText(metadataValue(entry.paragraphs[2])))).toEqual([
			"0",
			"false",
			"null",
			"&quot;&quot;",
			"",
			undefined,
			fixture.longDefault,
		]);
		expect(metadataValue(entries[5]?.paragraphs[2])).toBe("—");
	});

	it("renders only metadata for one selected property without its name, anchor, or schema description", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: "nested-fixture", property: "apps[].pm2" },
		});

		expect(selectedParagraphs(html)).toEqual([
			expect.stringMatching(/^<strong[^>]*>Input type:<\/strong> <code[^>]*>object<\/code>$/),
			expect.stringMatching(/^<strong[^>]*>Required:<\/strong> Yes$/),
			expect.stringMatching(/^<strong[^>]*>Input default:<\/strong> —$/),
		]);
		expect(html).not.toContain("Schema-owned process settings.");
		expect(html).not.toContain("apps[].pm2");
		expect(html).not.toMatch(/<(?:dl|dt|dd)\b|\bid=/);
		expectStaticMarkup(html);
	});

	it("renders descendants as vertical definitions and excludes delegated subtrees", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: {
				id: "nested-fixture",
				property: "apps[].pm2",
				includeChildren: true,
				exclude: ["apps[].pm2.env"],
			},
		});
		const entries = properties(html);

		expect(entries.map((entry) => entry.name)).toEqual(["apps[].pm2.enabled"]);
		expect(entries[0]?.paragraphs[3]).toBe("Enable process management.");
		expect(codeText(metadataValue(entries[0]?.paragraphs[2]))).toBe("false");
		expect(selectedParagraphs(html)).toHaveLength(3);
		expect(html).not.toContain("Schema-owned process settings.");
		expect(html).not.toContain("Process environment.");
		expect(html).not.toContain("pm2Extra");
	});

	it("omits a selected synthetic root description but retains unprefixed record descendants", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: "root-fixture", property: "(root)", includeChildren: true },
		});
		const entries = properties(html);

		expect(entries.map((entry) => entry.name)).toEqual(["[key]", "[key].enabled"]);
		expect(entries[1]?.paragraphs[3]).toBe("Enable a resource.");
		expect(selectedParagraphs(html)).toHaveLength(3);
		expect(html).not.toContain("Schema-owned root description.");
		expect(html).not.toContain("(root)");
	});

	it("retains the root and descendant summaries in the id-only fallback", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: "root-fixture" },
		});
		const entries = properties(html);

		expect(entries.map((entry) => entry.name)).toEqual(["(root)", "[key]", "[key].enabled"]);
		expect(entries[0]?.paragraphs[3]).toBe("Schema-owned root description.");
		expect(entries[2]?.paragraphs[3]).toBe("Enable a resource.");
		expect(html.match(/Schema-owned root description\./g)).toHaveLength(1);
	});

	it.each([
		{ property: "zero", defaultValue: "<code>0</code>" },
		{ property: "disabled", defaultValue: "<code>false</code>" },
		{ property: "nullable", defaultValue: "<code>null</code>" },
		{ property: "emptyString", defaultValue: "<code>&quot;&quot;</code>" },
		{ property: "emptyLabel", defaultValue: "<code></code>" },
		{ property: "absent", defaultValue: "—" },
	])("preserves the selected input default for $property", async ({ property, defaultValue }) => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: "defaults-fixture", property },
		});
		const paragraphs = selectedParagraphs(html);

		expect(paragraphs).toHaveLength(3);
		expect(metadataValue(paragraphs[2])?.replace(/<code\b[^>]*>/, "<code>")).toBe(defaultValue);
		expect(html).not.toMatch(/<(?:dl|dt|dd)\b/);
		expectStaticMarkup(html);
	});

	it("escapes selected metadata and defaults just as in the full reference", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: fixture.id, property: "__proto__" },
		});
		const paragraphs = selectedParagraphs(html);
		expect(codeText(metadataValue(paragraphs[0]))).toBe(
			"&lt;iframe src=javascript:alert(2)&gt; | type\nnext",
		);
		expect(paragraphs).toHaveLength(3);
		expect(html).not.toContain("description");
		expect(html).not.toContain("__proto__");
		expectStaticMarkup(html);

		const defaultHtml = await container.renderToString(ConfigReference, {
			props: { id: fixture.id, property: fixture.name },
		});
		expect(codeText(metadataValue(selectedParagraphs(defaultHtml)[2]))).toBe(
			"&quot;&lt;svg onload=alert(3)&gt; | default\\nnext&quot;",
		);
		expect(defaultHtml).not.toContain("&lt;img");
		expectStaticMarkup(defaultHtml);
	});

	it("respects the registry's shallow extraction setting", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, {
			props: { id: "shallow-fixture", property: "app", includeChildren: true },
		});
		expect(selectedParagraphs(html)).toHaveLength(3);
		expect(html).not.toMatch(/<(?:dl|dt|dd)\b/);
		expect(html).not.toContain("enabled");
	});

	it.each([
		{ property: "missing" },
		{ exclude: ["apps[].pm2"] },
		{ property: "apps", exclude: ["apps[].pm2"] },
		{ property: "apps", includeChildren: true, exclude: ["apps"] },
		{ property: "apps", includeChildren: true, exclude: ["apps[].missing"] },
	])("rejects invalid property selections: %j", async (selection) => {
		const container = await AstroContainer.create();
		await expect(
			container.renderToString(ConfigReference, { props: { id: "nested-fixture", ...selection } }),
		).rejects.toThrow(/configuration (?:property|exclusion)/i);
	});

	it("rejects an unknown registry ID instead of rendering an empty reference", async () => {
		const container = await AstroContainer.create();
		await expect(
			container.renderToString(ConfigReference, { props: { id: "missing-reference" } }),
		).rejects.toThrow("Unknown configuration reference: missing-reference");
	});
});
