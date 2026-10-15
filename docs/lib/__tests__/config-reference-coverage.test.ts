import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	getConfigReferenceRows,
	selectConfigFieldRows,
	selectConfigReferenceRows,
} from "../config-reference.js";
import { configReferences } from "../config-references.js";

// Shared test setup mocks fs and cwd; these fixtures must come from the real checkout.
const { readFileSync, readdirSync } = await vi.importActual<typeof import("node:fs")>("node:fs");

type ReferenceCall = {
	id: string;
	fieldsOnly?: boolean;
	caption?: string;
	property?: string;
	includeChildren?: boolean;
	exclude?: readonly string[];
	path: string;
};

/** A deliberately bounded parser for the literal, self-closing calls authored in these pages. */
function referenceCalls(source: string, path: string): ReferenceCall[] {
	const component = /<(ConfigReference|ConfigFieldTable)\b([^<>]*?)\/>/g;
	if (/<\/?(?:ConfigReference|ConfigFieldTable)\b/.test(source.replace(component, ""))) {
		throw new Error(`Unsupported ConfigReference syntax in ${path}`);
	}
	return [...source.matchAll(component)].map((match) => {
		let attributes = match[2]?.trim() ?? "";
		const call: ReferenceCall = { id: "", path };
		if (match[1] === "ConfigFieldTable") call.fieldsOnly = true;
		const seen = new Set<string>();
		while (attributes) {
			const literal = /^(id|property|caption)="([^"\n]*)"(?=\s|$)/.exec(attributes);
			const children = /^includeChildren(?=\s|$)/.exec(attributes);
			const excluded = /^exclude=\{\[([^\]\n]*)\]\}(?=\s|$)/.exec(attributes);
			const attribute = literal ?? children ?? excluded;
			if (!attribute)
				throw new Error(`Unsupported ConfigReference attributes in ${path}: ${attributes}`);
			const name = literal?.[1] ?? (children ? "includeChildren" : "exclude");
			if (seen.has(name)) throw new Error(`Duplicate ConfigReference ${name} in ${path}`);
			seen.add(name);
			if (literal) {
				if (literal[1] === "id") call.id = literal[2] ?? "";
				else if (literal[1] === "property") call.property = literal[2] ?? "";
				else call.caption = literal[2] ?? "";
			} else if (children) {
				call.includeChildren = true;
			} else {
				// JSON deliberately rejects expressions, spreads, and nonliteral array entries.
				const values: unknown = JSON.parse(`[${excluded?.[1] ?? ""}]`);
				if (!Array.isArray(values) || !values.every((value) => typeof value === "string")) {
					throw new Error(`Unsupported ConfigReference exclude in ${path}`);
				}
				call.exclude = values;
			}
			attributes = attributes.slice(attribute[0].length).trimStart();
		}
		if (!call.id) throw new Error(`Missing ConfigReference id in ${path}`);
		if (call.fieldsOnly && (!call.property || !call.caption || call.includeChildren)) {
			throw new Error(
				`ConfigFieldTable requires property and caption, not includeChildren: ${path}`,
			);
		}
		if (!call.fieldsOnly && call.caption !== undefined) {
			throw new Error(`ConfigReference does not accept caption: ${path}`);
		}
		return call;
	});
}

function readReferenceCalls(directory: URL): ReferenceCall[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) return readReferenceCalls(new URL(`${entry.name}/`, directory));
		if (!entry.name.endsWith(".mdx")) return [];
		const url = new URL(entry.name, directory);
		return referenceCalls(readFileSync(url, "utf8"), fileURLToPath(url));
	});
}

function coverageProblems(calls: ReferenceCall[]): string[] {
	const references = configReferences.map((reference) => ({
		id: reference.id,
		rows: getConfigReferenceRows(reference.schema, { nested: reference.nested }),
	}));
	const occurrences = new Map<string, string[]>();
	for (const reference of references) {
		for (const row of reference.rows) occurrences.set(`${reference.id}:${row.name}`, []);
	}
	for (const call of calls) {
		const reference = references.find((entry) => entry.id === call.id);
		if (!reference) throw new Error(`Unknown ConfigReference ${call.id} in ${call.path}`);
		if (call.fieldsOnly) {
			if (!call.property) throw new Error("ConfigFieldTable requires property");
			selectConfigFieldRows(reference.rows, { property: call.property, exclude: call.exclude });
		}
		const selected = selectConfigReferenceRows(reference.rows, {
			...call,
			includeChildren: call.fieldsOnly || call.includeChildren,
		});
		for (const row of call.fieldsOnly ? selected.slice(1) : selected) {
			occurrences.get(`${call.id}:${row.name}`)?.push(call.path);
		}
	}
	return [...occurrences].flatMap(([key, paths]) =>
		paths.length === 1
			? []
			: [`${key} rendered ${paths.length} times${paths.length ? ` in ${paths.join(", ")}` : ""}`],
	);
}

const calls = readReferenceCalls(new URL("../../reference/", import.meta.url));

describe("authored configuration reference coverage", () => {
	it("renders every registered schema row exactly once across the reference pages", () => {
		expect(coverageProblems(calls)).toEqual([]);
	});

	it.each(["windowsApi", "apps[].windows", "apps[].logging"])(
		"keeps %s children in authored sections with their own metadata",
		(property) => {
			const reference = configReferences.find((entry) => entry.id === "monitor-options");
			if (!reference) throw new Error("Missing monitor reference");
			const rows = getConfigReferenceRows(reference.schema, { nested: reference.nested });
			const children = selectConfigReferenceRows(rows, { property, includeChildren: true }).slice(
				1,
			);
			const source = readFileSync(
				new URL("../../reference/monitor/monitor-config.mdx", import.meta.url),
				"utf8",
			);
			const section = source.split(`### \`${property.split(".").at(-1)}\``)[1]?.split("\n### ")[0];
			expect(section).toBeDefined();
			const [parentSection = "", ...childSections] = (section ?? "").split("\n#### ");
			const parentCalls = referenceCalls(parentSection, "monitor-config.mdx");
			expect(parentCalls).toHaveLength(1);
			expect(selectConfigReferenceRows(rows, parentCalls[0]).map((row) => row.name)).toEqual([
				property,
			]);
			expect(children.length).toBeGreaterThan(0);
			expect(childSections).toHaveLength(children.length);
			for (const [index, child] of children.entries()) {
				const childSection = childSections[index] ?? "";
				expect(childSection).toMatch(`\`${child.name.slice(property.length + 1)}\`\n\n`);
				expect(referenceCalls(childSection, "monitor-config.mdx")).toEqual([
					{ id: reference.id, property: child.name, path: "monitor-config.mdx" },
				]);
			}
		},
	);

	it("documents the scheduler command runtime default outside generated input metadata", () => {
		const reference = configReferences.find((entry) => entry.id === "scheduler-options");
		expect(reference).toBeDefined();
		if (!reference) throw new Error("Missing scheduler reference");
		const command = getConfigReferenceRows(reference.schema).find((row) => row.name === "command");
		expect(command).toBeDefined();
		expect(command?.defaultValue).toBeUndefined();

		const source = readFileSync(
			new URL("../../reference/scheduler/scheduler-config.mdx", import.meta.url),
			"utf8",
		);
		const section = source.split("### `command`")[1]?.split("### ")[0];
		expect(section).toContain('<ConfigReference id="scheduler-options" property="command" />');
		expect(section).toContain("`{ type: <record key> }`");
	});

	it("puts small-object explanations and examples before their field tables", () => {
		for (const [page, property] of [
			["content/content-config", "versioning"],
			["monitor/monitor-config", "apps[].pm2"],
			["scheduler/scheduler-config", "retry.backoff"],
		]) {
			const source = readFileSync(new URL(`../../reference/${page}.mdx`, import.meta.url), "utf8");
			const content = source.split(`property="${property}" />`)[1]?.split(/\n#{3,4} /)[0];
			expect(content).toBeDefined();
			expect(content).toMatch(/```typescript[\s\S]*```[\s\S]*<ConfigFieldTable/);
		}
	});

	it("names the ContentSource item shape instead of treating array fields as source options", () => {
		const source = readFileSync(
			new URL("../../reference/content/content-config.mdx", import.meta.url),
			"utf8",
		);
		expect(source).toContain("#### `ContentSource`");
		expect(source).toContain("relative to one `sources[]` item");
		expect(
			calls.filter((call) => call.id === "content-options" && call.property === "sources"),
		).toEqual([
			{ id: "content-options", property: "sources", path: expect.any(String) },
			{
				id: "content-options",
				property: "sources",
				fieldsOnly: true,
				caption: "ContentSource fields",
				path: expect.any(String),
			},
		]);
	});

	it("keeps limited and forever retry requirements explicit, outside the merged input metadata", () => {
		const source = readFileSync(
			new URL("../../reference/scheduler/scheduler-config.mdx", import.meta.url),
			"utf8",
		);
		const limited = source.split("#### `maxAttempts` (limited policy)")[1]?.split("\n#### ")[0];
		expect(limited).toContain('property="retry.maxAttempts"');
		expect(limited).toContain("Required when `forever: false`");
		expect(limited).toContain("it cannot be combined with `backoff`");
		const forever = source.split("#### `backoff` (forever policy)")[1]?.split("\n### ")[0];
		expect(forever).toContain("Available only with the forever policy");
		expect(forever).toContain("runtime defaults described in the table, not schema input defaults");
		expect(forever).toContain('<ConfigFieldTable id="scheduler-options" property="retry.backoff"');
		expect(source).toContain("retry: { forever: false, maxAttempts: 3 }");
		expect(source).toContain("retry: { forever: true, backoff:");
	});

	it("detects an introductory full list duplicated by individual property sections", () => {
		const problems = coverageProblems([
			{ id: "content-options", path: "regression.mdx" },
			...calls,
		]);
		expect(problems).toEqual(
			expect.arrayContaining([expect.stringContaining("content-options:sources rendered 2 times")]),
		);
	});

	it("detects a missing property section and its descendants", () => {
		const problems = coverageProblems(
			calls.filter((call) => call.id !== "content-options" || call.property !== "sources"),
		);
		expect(problems).toContain("content-options:sources rendered 0 times");
		expect(problems).toContain("content-options:sources[].fetch rendered 0 times");
	});
});

describe("authored ConfigReference call syntax", () => {
	it("reads literal paths, descendants, and exclusions without evaluating MDX", () => {
		expect(
			referenceCalls(
				'<ConfigReference id="scheduler-options" property="retry" includeChildren exclude={["retry.backoff"]} />',
				"example.mdx",
			),
		).toEqual([
			{
				id: "scheduler-options",
				property: "retry",
				includeChildren: true,
				exclude: ["retry.backoff"],
				path: "example.mdx",
			},
		]);
	});

	it("reads schema-backed field tables separately from parent metadata", () => {
		expect(
			referenceCalls(
				'<ConfigFieldTable id="content-options" property="versioning" caption="Object fields" />',
				"example.mdx",
			),
		).toEqual([
			{
				id: "content-options",
				property: "versioning",
				fieldsOnly: true,
				caption: "Object fields",
				path: "example.mdx",
			},
		]);
	});

	it.each([
		"<ConfigReference id={referenceId} />",
		'<ConfigFieldTable id="content-options" />',
		'<ConfigFieldTable id="content-options" property="versioning" />',
		'<ConfigFieldTable id="content-options" property="versioning" caption="Fields" includeChildren />',
		'<ConfigReference id="content-options" caption="Fields" />',
		'<ConfigReference id="content-options" {...options} />',
		'<ConfigReference id="content-options" includeChildren={true} />',
		'<ConfigReference id="content-options" exclude={[somePath]} />',
		'<ConfigReference id="content-options" exclude={[42]} />',
		'<ConfigReference id="content-options" id="monitor-options" />',
		'<ConfigReference id="content-options"></ConfigReference>',
		'<ConfigReference property="sources" />',
	])("rejects unsupported or ambiguous syntax: %s", (source) => {
		expect(() => referenceCalls(source, "unsupported.mdx")).toThrow();
	});
});
