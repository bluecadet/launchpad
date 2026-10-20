import { describe, expect, it } from "vitest";
import { z } from "zod";
import { configSchema } from "../config-schema.js";

interface ExampleConfig {
	name: string;
	count?: number;
	nested?: {
		enabled?: boolean;
	};
}

const exampleShape = {
	name: z.string(),
	count: z.number().default(1),
	nested: z.object({ enabled: z.boolean().default(true) }).prefault({}),
};

describe("configSchema", () => {
	it("returns the schema unchanged", () => {
		const schema = z.object(exampleShape);

		expect(configSchema<ExampleConfig>()(schema)).toBe(schema);
	});

	it("accepts a schema whose input exactly matches the interface", () => {
		const schema = configSchema<ExampleConfig>()(z.object(exampleShape));

		expect(schema.parse({ name: "a" })).toEqual({ name: "a", count: 1, nested: { enabled: true } });
	});

	it("rejects schemas that drift from the interface", () => {
		// @ts-expect-error schema has a field the interface lacks
		configSchema<ExampleConfig>()(z.object({ ...exampleShape, extra: z.string().optional() }));
		// @ts-expect-error schema is missing a field the interface declares
		configSchema<ExampleConfig>()(z.object({ name: z.string(), count: z.number().default(1) }));
		// @ts-expect-error schema requires a field the interface marks optional
		configSchema<ExampleConfig>()(z.object({ ...exampleShape, count: z.number() }));
		const nestedMismatch = z.object({ ...exampleShape, nested: z.object({ enabled: z.string() }) });
		// @ts-expect-error nested field type differs
		configSchema<ExampleConfig>()(nestedMismatch);
	});
});
