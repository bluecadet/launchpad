import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";
import ConfigReference from "../ConfigReference.astro";

const fixture = vi.hoisted(() => ({
	id: "unsafe-fixture",
	name: "<img src=x onerror=alert(1)> | option\nnext",
	type: "<iframe src=javascript:alert(2)> | type\nnext",
	defaultValue: "<svg onload=alert(3)> | default\nnext",
	description: "<script>alert(4)</script> & | description\nnext",
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
		],
	};
});

const labels = ["Option", "Input type", "Required", "Input default", "Description"];

describe("ConfigReference", () => {
	it("escapes schema text in a five-column responsive table without hydration", async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(ConfigReference, { props: { id: fixture.id } });

		expect(html).toContain('class="table-wrap"');
		expect([...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/gs)].map((match) => match[1])).toEqual(labels);
		const body = html.match(/<tbody\b[^>]*>(.*?)<\/tbody>/s)?.[1];
		expect(body).toBeDefined();
		const rows = [...(body ?? "").matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)];
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			const cells = [...(row[1] ?? "").matchAll(/<td\b([^>]*)>(.*?)<\/td>/gs)];
			expect(cells).toHaveLength(5);
			expect(cells.map((cell) => cell[1]?.match(/data-label="([^"]+)"/)?.[1])).toEqual(labels);
		}

		// These are text nodes, including pipes and actual newlines, not Markdown or HTML.
		expect(html).toMatch(/<code\b[^>]*>__proto__<\/code>/);
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; | option\nnext");
		expect(html).toContain("&lt;iframe src=javascript:alert(2)&gt; | type\nnext");
		expect(html).toContain("&quot;&lt;svg onload=alert(3)&gt; | default\\nnext&quot;");
		expect(html).toContain("&lt;script&gt;alert(4)&lt;/script&gt; &amp; | description\nnext");
		expect(html).toMatch(/data-label="Required"[^>]*>Yes<\/td>/);
		expect(html).toMatch(/data-label="Required"[^>]*>No<\/td>/);
		expect(html).toMatch(/data-label="Input default"[^>]*>—<\/td>/);
		expect(html).not.toMatch(/<(?:img|iframe|svg|script|astro-island|astro-server-island)\b/i);
	});

	it("rejects an unknown registry ID instead of rendering an empty reference", async () => {
		const container = await AstroContainer.create();
		await expect(
			container.renderToString(ConfigReference, { props: { id: "missing-reference" } }),
		).rejects.toThrow("Unknown configuration reference: missing-reference");
	});
});
