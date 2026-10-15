import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type ConfigReferenceRow, getConfigReferenceRows } from "../config-reference.js";

function row(
	name: string,
	type: string,
	required: boolean,
	defaultValue: string | undefined = undefined,
	description = "",
): ConfigReferenceRow {
	return { name, type, required, defaultValue, description };
}

describe("getConfigReferenceRows", () => {
	it("returns deterministic input reference rows with descriptions", () => {
		const schema = z.object({
			name: z.string().min(1).describe("Human-readable name."),
			count: z.number().int().positive().optional(),
			active: z.boolean(),
		});
		expect(getConfigReferenceRows(schema)).toEqual([
			row("name", "string", true, undefined, "Human-readable name."),
			row("count", "number", false),
			row("active", "boolean", true),
		]);
		expect(getConfigReferenceRows(schema)).toEqual(getConfigReferenceRows(schema));
	});

	it("unwraps optional, readonly, nullable, default and prefault inputs", () => {
		const schema = z.object({
			optional: z.string().optional().readonly(),
			nullable: z.string().nullable(),
			defaulted: z.number().default(0),
			prefaulted: z.string().transform(Number).prefault("0"),
			required: z.string().optional().nonoptional(),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("optional", "string", false));
		expect(output).toContainEqual(row("nullable", "string | null", true));
		expect(output).toContainEqual(row("defaulted", "number", false, "0"));
		expect(output).toContainEqual(row("prefaulted", "string", false, '"0"'));
		expect(output).toContainEqual(row("required", "string", true));
	});

	it("never executes refinements, transforms, preprocessing, or labeled defaults", () => {
		const callback = vi.fn(() => {
			throw new Error("must not execute");
		});
		const schema = z.object({
			refined: z.string().refine(callback),
			transformed: z.string().transform(callback),
			defaulted: z
				.string()
				.default(callback)
				.meta({ configDocs: { defaultLabel: "contextual" } }),
			prefaulted: z
				.string()
				.prefault(callback)
				.meta({ configDocs: { defaultLabel: "contextual" } }),
			preprocessed: z
				.preprocess(callback, z.object({ enabled: z.boolean() }))
				.meta({ configDocs: { inputType: "boolean | object", propertiesFrom: "output" } }),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("transformed", "string", true));
		expect(output).toContainEqual(row("defaulted", "string", false, "contextual"));
		expect(output).toContainEqual(row("preprocessed.enabled", "boolean", true));
		expect(callback).not.toHaveBeenCalled();
	});

	it("reads Zod default factories, but never invokes callbacks returned as values", () => {
		const carriedCallback = vi.fn(() => {
			throw new Error("must not execute");
		});
		const factory = vi.fn(() => carriedCallback);
		const schema = z.object({
			count: z.number().default(() => 3),
			callback: z
				.custom<() => never>()
				.meta({ configDocs: { inputType: "Callback" } })
				.default(factory),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("count", "number", false, "3"));
		expect(output).toContainEqual(
			row("callback", "Callback", false, "Function (set configDocs.defaultLabel)"),
		);
		expect(factory).toHaveBeenCalledTimes(1);
		expect(carriedCallback).not.toHaveBeenCalled();
	});

	it.each(["default", "prefault"] as const)(
		"uses inherited contextual labels before reading a %s factory",
		(wrapper) => {
			const factory = vi.fn(() => {
				throw new Error("must not execute");
			});
			const input = z
				.string()
				.meta({ configDocs: { defaultLabel: "Contextual" } })
				.readonly();
			const schema = z.object({ value: input[wrapper](factory) });
			expect(getConfigReferenceRows(schema)).toEqual([row("value", "string", false, "Contextual")]);
			expect(factory).not.toHaveBeenCalled();
		},
	);

	it("reads only the outer default, leaving shadowed factories unexecuted", () => {
		const shadowed = vi.fn(() => {
			throw new Error("must not execute");
		});
		const outer = vi.fn(() => "outer");
		const schema = z.object({
			value: z.string().default(shadowed).optional().default(outer),
			child: z.object({ value: z.string().default("child") }).default({ value: "parent" }),
		});
		const rows = getConfigReferenceRows(schema);
		expect(rows).toContainEqual(row("value", "string", false, '"outer"'));
		expect(rows).toContainEqual(row("child.value", "string", false, '"child"'));
		expect(shadowed).not.toHaveBeenCalled();
		expect(outer).toHaveBeenCalledTimes(1);
	});

	it("labels ambiguous union defaults without evaluating branch validity or order", () => {
		const refinement = vi.fn(() => {
			throw new Error("must not execute");
		});
		const schema = z.object({
			alternatives: z.union([z.string().default("first"), z.number().default(2)]),
			optionalFirst: z.union([z.string().optional(), z.number().default(2)]),
			defaultFirst: z.union([z.number().default(2), z.string().optional()]),
			refined: z.union([z.string().default("first").refine(refinement), z.number().default(2)]),
			agreed: z.union([z.string().default("same"), z.literal("same").default("same")]),
			absent: z.union([z.string(), z.number()]),
		});
		const rows = getConfigReferenceRows(schema);
		for (const name of ["alternatives", "optionalFirst", "defaultFirst", "refined"]) {
			expect(rows.find((entry) => entry.name === name)?.defaultValue).toBe("Branch-dependent");
		}
		expect(rows.find((entry) => entry.name === "agreed")?.defaultValue).toBe('"same"');
		expect(rows.find((entry) => entry.name === "absent")?.defaultValue).toBeUndefined();
		expect(refinement).not.toHaveBeenCalled();
	});

	it("prioritizes an outer default over union branch defaults", () => {
		const branchFactory = vi.fn(() => {
			throw new Error("must not execute");
		});
		const schema = z.object({
			value: z.union([z.string().default(branchFactory), z.number().default(2)]).default("outer"),
		});
		expect(getConfigReferenceRows(schema)).toEqual([
			row("value", "string | number", false, '"outer"'),
		]);
		expect(branchFactory).not.toHaveBeenCalled();
	});

	it("preserves falsy data defaults without treating output transforms as input", () => {
		const schema = z.object({
			zero: z.number().default(0),
			false: z.boolean().default(false),
			empty: z.string().default(""),
			null: z.string().nullable().default(null),
			prefault: z.string().transform(Number).prefault("0"),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("zero", "number", false, "0"));
		expect(output).toContainEqual(row("false", "boolean", false, "false"));
		expect(output).toContainEqual(row("empty", "string", false, '""'));
		expect(output).toContainEqual(row("null", "string | null", false, "null"));
		expect(output).toContainEqual(row("prefault", "string", false, '"0"'));
	});

	it("distinguishes absent defaults, explicit undefined and empty contextual labels", () => {
		const schema = z.object({
			absent: z.string(),
			explicit: new z.ZodDefault({
				type: "default",
				innerType: z.undefined(),
				defaultValue: undefined,
			}),
			emptyLabel: z.string().meta({ configDocs: { defaultLabel: "" } }),
		});
		expect(getConfigReferenceRows(schema)).toEqual([
			row("absent", "string", true),
			row("explicit", "undefined", false, "undefined"),
			row("emptyLabel", "string", true, ""),
		]);
	});

	it("never invokes toJSON hooks carried in default values", () => {
		const toJSON = vi.fn(() => {
			throw new Error("must not execute");
		});
		const schema = new z.ZodDefault({
			type: "default",
			innerType: z.object({}),
			defaultValue: { toJSON, enabled: false },
		});
		expect(getConfigReferenceRows(schema)).toEqual([
			row(
				"(root)",
				"object",
				false,
				'{"toJSON":Function (set configDocs.defaultLabel),"enabled":false}',
			),
		]);
		expect(toJSON).not.toHaveBeenCalled();
	});

	it("labels non-JSON defaults without invoking getters or serialization hooks", () => {
		const getter = vi.fn(() => {
			throw new Error("must not execute");
		});
		const value = {
			get secret() {
				return getter();
			},
		};
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const schema = z.object({
			accessor: new z.ZodDefault({ type: "default", innerType: z.object({}), defaultValue: value }),
			cycle: new z.ZodDefault({ type: "default", innerType: z.object({}), defaultValue: cyclic }),
			date: new z.ZodDefault({ type: "default", innerType: z.date(), defaultValue: new Date(0) }),
			large: new z.ZodDefault({ type: "default", innerType: z.bigint(), defaultValue: 1n }),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(
			row("accessor", "object", false, "Accessor value (set configDocs.defaultLabel)"),
		);
		expect(output).toContainEqual(
			row("cycle", "object", false, '{"self":Circular value (set configDocs.defaultLabel)}'),
		);
		expect(output).toContainEqual(
			row("date", "Date", false, "Non-JSON value (set configDocs.defaultLabel)"),
		);
		expect(output).toContainEqual(row("large", "bigint", false, "1n"));
		expect(getter).not.toHaveBeenCalled();
	});

	it("describes nested object, array and record fields with parent-relative requiredness", () => {
		const schema = z.object({
			settings: z.object({ enabled: z.boolean(), label: z.string().optional() }).optional(),
			apps: z.array(z.object({ name: z.string(), args: z.array(z.string()) })),
			env: z.record(z.string(), z.object({ value: z.string() })),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("settings", "object", false));
		expect(output).toContainEqual(row("settings.enabled", "boolean", true));
		expect(output).toContainEqual(row("settings.label", "string", false));
		expect(output).toContainEqual(row("apps", "object[]", true));
		expect(output).toContainEqual(row("apps[].name", "string", true));
		expect(output).toContainEqual(row("apps[].args", "string[]", true));
		expect(output).toContainEqual(row("env", "Record<string, object>", true));
		expect(output).toContainEqual(row("env[key]", "object", false));
		expect(output).toContainEqual(row("env[key].value", "string", true));
		const shallow = getConfigReferenceRows(schema, { nested: false });
		expect(shallow).toContainEqual(row("settings", "object", false));
		expect(shallow.map((entry) => entry.name)).not.toContain("settings.enabled");
		expect(shallow.map((entry) => entry.name)).not.toContain("apps[].name");
		expect(shallow.map((entry) => entry.name)).not.toContain("env[key]");
	});

	it("retains all union fields and merges common field types and requiredness", () => {
		const schema = z.object({
			choice: z.union([
				z.object({ common: z.string(), first: z.boolean(), optional: z.string() }),
				z.object({ common: z.number(), second: z.boolean(), optional: z.string().optional() }),
			]),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("choice.common", "string | number", true));
		expect(output).toContainEqual(row("choice.first", "boolean", false));
		expect(output).toContainEqual(row("choice.second", "boolean", false));
		expect(output).toContainEqual(row("choice.optional", "string", false));
		expect(output.filter((entry) => entry.name === "choice.common")).toHaveLength(1);
	});

	it("supports discriminated unions and primitive/object unions", () => {
		const schema = z.object({
			choice: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("a"), a: z.string() }),
				z.object({ kind: z.literal("b"), b: z.number() }),
			]),
			versioning: z.union([z.boolean(), z.object({ keep: z.number() })]),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("choice.kind", '"a" | "b"', true));
		expect(output).toContainEqual(row("choice.a", "string", false));
		expect(output).toContainEqual(row("choice.b", "number", false));
		expect(output).toContainEqual(row("versioning", "boolean | object", true));
		expect(output).toContainEqual(row("versioning.keep", "number", false));
	});

	it("merges intersections, requiring a shared field when either side requires it", () => {
		const schema = z.intersection(
			z.object({ a: z.string(), both: z.string().optional() }),
			z.object({ b: z.number(), both: z.string() }),
		);
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("a", "string", true));
		expect(output).toContainEqual(row("b", "number", true));
		expect(output).toContainEqual(row("both", "string", true));
	});

	it("preserves promises within unions and arrays without inspecting transform output", () => {
		const source = z.object({ url: z.string() });
		const schema = z.object({
			sources: z.array(z.union([source, z.promise(source)])).transform(() => 1),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("sources", "(object | Promise<object>)[]", true));
		expect(output).toContainEqual(row("sources[].url", "string", true));
	});

	it("uses pipe inputs, while explicitly opting into downstream preprocess properties", () => {
		const callback = vi.fn((value: unknown) => value);
		const schema = z.object({
			input: z.object({ before: z.string() }).transform(() => ({ after: 1 })),
			preprocessed: z
				.preprocess(callback, z.object({ interval: z.string(), enabled: z.boolean() }))
				.optional()
				.meta({ configDocs: { inputType: "string | object", propertiesFrom: "output" } }),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("input.before", "string", true));
		expect(output.map((entry) => entry.name)).not.toContain("input.after");
		expect(output).toContainEqual(row("preprocessed", "string | object", false));
		expect(output).toContainEqual(row("preprocessed.interval", "string", true));
		expect(callback).not.toHaveBeenCalled();
	});

	it("applies nearest wrapper metadata without changing fields or input requiredness", () => {
		const schema = z.object({
			opaque: z
				.custom()
				.meta({ configDocs: { inputType: "Inner" } })
				.optional()
				.meta({ configDocs: { inputType: "Outer", defaultLabel: "contextual" } })
				.readonly(),
			object: z.object({ enabled: z.boolean() }).meta({ configDocs: { inputType: "Options" } }),
			function: z.function().meta({ configDocs: { inputType: "() => void" } }),
			anything: z.any().meta({ configDocs: { inputType: "Plugin" } }),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("opaque", "Outer", false, "contextual"));
		expect(output).toContainEqual(row("object", "Options", true));
		expect(output).toContainEqual(row("object.enabled", "boolean", true));
		expect(output).toContainEqual(row("function", "() => void", true));
		expect(output).toContainEqual(row("anything", "Plugin", true));
	});

	it("uses the closest wrapper description", () => {
		const schema = z.object({
			name: z.string().describe("Inner").optional().describe("Outer").readonly(),
		});
		expect(getConfigReferenceRows(schema)).toContainEqual(
			row("name", "string", false, undefined, "Outer"),
		);
	});

	it("describes literals, enums and the supported primitives", () => {
		const schema = z.object({
			literal: z.literal([0, false, ""]),
			enum: z.enum(["one", "two"]),
			bigint: z.bigint(),
			symbol: z.symbol(),
			null: z.null(),
			undefined: z.undefined(),
			void: z.void(),
			never: z.never(),
			date: z.date(),
			nan: z.nan(),
		});
		const output = getConfigReferenceRows(schema);
		expect(output).toContainEqual(row("literal", '0 | false | ""', true));
		expect(output).toContainEqual(row("enum", '"one" | "two"', true));
		for (const type of ["bigint", "symbol", "null", "never"])
			expect(output).toContainEqual(row(type, type, true));
		expect(output).toContainEqual(row("undefined", "undefined", true));
		expect(output).toContainEqual(row("void", "void", true));
		expect(output).toContainEqual(row("date", "Date", true));
		expect(output).toContainEqual(row("nan", "NaN", true));
	});

	it.each([z.custom(), z.any(), z.function(), z.transform((value) => value)])(
		"requires documentation for opaque schemas at a useful field path",
		(opaque) => {
			expect(() =>
				getConfigReferenceRows(z.object({ nested: z.array(z.object({ opaque })) })),
			).toThrow(/nested\[\]\.opaque: unsupported .*configDocs.*inputType/);
		},
	);

	it("supports native unknown and validation-only intersection guards without phantom rows", () => {
		const guard = z
			.unknown()
			.superRefine(() => {
				throw new Error("must not execute");
			})
			.transform(() => ({}));
		const output = getConfigReferenceRows(z.intersection(z.object({ name: z.string() }), guard));
		expect(output).toContainEqual(row("name", "string", true));
		expect(output.map((entry) => entry.name)).not.toContain("(root)");
		expect(getConfigReferenceRows(z.object({ value: z.unknown() }))).toContainEqual(
			row("value", "unknown", true),
		);
	});

	it("preserves embedded backticks and backslashes as plain text", () => {
		const schema = z.object({
			"a`b": z.string().meta({ configDocs: { defaultLabel: "C:\\temp" } }),
		});
		expect(getConfigReferenceRows(schema)).toEqual([row("a`b", "string", true, "C:\\temp")]);
	});

	it("rejects unsupported kinds with paths rather than rendering unknown", () => {
		expect(() =>
			getConfigReferenceRows(z.object({ nested: z.object({ tuple: z.tuple([z.string()]) }) })),
		).toThrow("Cannot document schema at nested.tuple: unsupported tuple");
		const lazy = vi.fn(() => z.string());
		expect(() => getConfigReferenceRows(z.lazy(lazy))).toThrow("(root): unsupported lazy");
		expect(lazy).not.toHaveBeenCalled();
	});

	it.each(["|", "\\|", "\\\\|", "\\\\\\|", "`|", "\n", "\r\n", "<key> & more"])(
		"preserves literal separators and HTML characters %j in every text field",
		(separator) => {
			const text = `x${separator}y`;
			const schema = z.object({
				[text]: z.custom().meta({
					description: text,
					configDocs: { inputType: text, defaultLabel: text },
				}),
			});
			expect(getConfigReferenceRows(schema)).toEqual([row(text, text, true, text, text)]);
		},
	);

	it("preserves prose and line breaks without interpreting or escaping them", () => {
		const description = "__proto__ *stars* ~~strike~~ [link](url) `code` \\|\n<key> & more";
		const schema = z.object({ value: z.string().describe(description) });
		expect(getConfigReferenceRows(schema)).toEqual([
			row("value", "string", true, undefined, description),
		]);
	});

	it("retains mixed root input shapes alongside their object fields", () => {
		const output = getConfigReferenceRows(
			z.union([z.string(), z.object({ enabled: z.boolean() })]),
		);
		expect(output).toContainEqual(row("(root)", "string | object", true));
		expect(output).toContainEqual(row("enabled", "boolean", false));
		const preprocessed = z
			.preprocess((value) => value, z.object({ enabled: z.boolean() }))
			.meta({ configDocs: { inputType: "string | Options", propertiesFrom: "output" } });
		const preprocessedOutput = getConfigReferenceRows(preprocessed);
		expect(preprocessedOutput).toContainEqual(row("(root)", "string | Options", false));
		expect(preprocessedOutput).toContainEqual(row("enabled", "boolean", true));
		expect(getConfigReferenceRows(z.object({ enabled: z.boolean() }).nullable())).toContainEqual(
			row("(root)", "object | null", true),
		);
	});

	it.each([
		z.unknown(),
		z.undefined(),
		z.void(),
		z.literal(undefined),
		z.intersection(z.string().optional(), z.string().optional()),
	])("distinguishes omitted object properties from explicit undefined", (schema) => {
		const object = z.object({ value: schema });
		expect(object.safeParse({}).success).toBe(false);
		expect(object.safeParse({ value: undefined }).success).toBe(true);
		expect(getConfigReferenceRows(object)[0]?.required).toBe(true);
	});

	it("uses structural input omission through wrappers and pipes", () => {
		const output = getConfigReferenceRows(
			z.object({
				optional: z.string().optional().nullable().readonly(),
				defaulted: z.string().default("a"),
				prefaulted: z.string().prefault("a"),
				union: z.union([z.string(), z.number().optional()]),
				pipe: z
					.string()
					.optional()
					.transform(() => "resolved"),
				preprocess: z
					.preprocess((value) => value, z.string().optional())
					.meta({ configDocs: { inputType: "string" } }),
				nonoptional: z.string().optional().nonoptional(),
			}),
		);
		for (const key of ["optional", "defaulted", "prefaulted", "union", "pipe", "preprocess"]) {
			expect(output.find((entry) => entry.name === key)?.required).toBe(false);
		}
		expect(output).toContainEqual(row("nonoptional", "string", true));
	});

	it("describes non-object roots with an explicit root label without losing collection types", () => {
		expect(getConfigReferenceRows(z.string())).toContainEqual(row("(root)", "string", true));
		const object = z.object({ name: z.string() });
		const promise = getConfigReferenceRows(z.promise(object));
		expect(promise).toContainEqual(row("(root)", "Promise<object>", true));
		expect(promise).toContainEqual(row("name", "string", true));
		const array = getConfigReferenceRows(z.array(object));
		expect(array).toContainEqual(row("(root)", "object[]", true));
		expect(array).toContainEqual(row("[].name", "string", true));
	});
});
