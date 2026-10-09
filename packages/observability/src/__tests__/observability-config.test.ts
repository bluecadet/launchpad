import { describe, expect, it } from "vitest";
import {
	deliveryConfigSchema,
	observationConfigSchema,
	resourceAttributesSchema,
} from "../observability-config.js";

describe("resourceAttributesSchema", () => {
	it("accepts a flat primitive attribute bag and a custom service name", () => {
		const resource = {
			"service.name": "gallery-controller",
			"deployment.environment.name": "production",
			"launchpad.client": "bluecadet",
			"launchpad.project": "museum",
			"launchpad.installation": "lobby",
			region: "us-east",
			floor: 2,
			public: true,
		};

		expect(resourceAttributesSchema.parse(resource)).toEqual(resource);
	});

	it.each([
		{ "": "value" },
		{ "   ": "value" },
		{ ["x".repeat(129)]: "value" },
		{ value: "x".repeat(1_025) },
		{ value: Number.POSITIVE_INFINITY },
		{ value: Number.NaN },
		{ value: null },
		{ "service.name": true },
		{ "service.name": "  " },
		{ "service.instance.id": "caller-owned" },
	])("rejects invalid resource attributes %#", (resource) => {
		expect(resourceAttributesSchema.safeParse(resource).success).toBe(false);
	});

	it.each([JSON.parse('{"__proto__":"museum"}'), JSON.parse('{"__proto__":{"nested":"invalid"}}')])(
		"rejects an own __proto__ attribute before record parsing",
		(resource) => {
			expect(Object.hasOwn(resource, "__proto__")).toBe(true);
			expect(resourceAttributesSchema.safeParse(resource).success).toBe(false);
		},
	);

	it("preserves ordinary own constructor and toString attributes", () => {
		const resource = { constructor: "museum", toString: "display" };
		const parsed = resourceAttributesSchema.parse(resource);

		expect(parsed).toEqual(resource);
		expect(Object.hasOwn(parsed, "constructor")).toBe(true);
		expect(Object.hasOwn(parsed, "toString")).toBe(true);
	});

	it("bounds the number of caller-provided resource attributes", () => {
		const resource = Object.fromEntries(
			Array.from({ length: 65 }, (_, index) => [`attribute.${index}`, index]),
		);

		expect(resourceAttributesSchema.safeParse(resource).success).toBe(false);
	});
});

describe("destination-mode configuration schemas", () => {
	it("applies observation defaults", () => {
		expect(observationConfigSchema.parse({})).toEqual({ intervalMs: 30_000 });
	});

	it("applies delivery defaults", () => {
		expect(deliveryConfigSchema.parse({})).toEqual({
			deliveryTimeoutMs: 5_000,
			shutdownTimeoutMs: 3_000,
			maxQueuedBatches: 50,
		});
	});

	it.each([
		[observationConfigSchema, { intervalMs: 0 }],
		[deliveryConfigSchema, { deliveryTimeoutMs: -1 }],
		[deliveryConfigSchema, { shutdownTimeoutMs: Number.POSITIVE_INFINITY }],
		[deliveryConfigSchema, { maxQueuedBatches: 10_001 }],
	] as const)("rejects invalid bounded values", (schema, value) => {
		expect(schema.safeParse(value).success).toBe(false);
	});
});
