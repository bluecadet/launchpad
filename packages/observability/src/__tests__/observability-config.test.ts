import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { ok, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { ObservabilityDestination } from "../core/destination.js";
import { observability } from "../index.js";
import {
	deliveryConfigSchema,
	destinationObservabilityConfigSchema,
	legacyObservabilityConfigSchema,
	observabilityConfigSchema,
	observationConfigSchema,
	resourceAttributesSchema,
} from "../observability-config.js";

function destination(name: string): ObservabilityDestination {
	return {
		name,
		create: () => ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) } }),
	};
}

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

describe("observabilityConfigSchema", () => {
	it("resolves legacy and destination modes with their defaults", () => {
		const transports: [] = [];
		const configuredDestinations: readonly ObservabilityDestination[] = [destination("logs")];

		const legacy = observabilityConfigSchema.parse({ transports });
		expect(legacy).toMatchObject({
			include: ["log:*"],
			exclude: [],
			batch: { intervalMs: 1_000, maxEntries: 100 },
			buffer: { maxBatches: 50, maxRetries: 3 },
		});
		expect(legacy.transports).toBe(transports);

		const resolvedDestination = observabilityConfigSchema.parse({
			destinations: configuredDestinations,
		});
		expect(resolvedDestination).toMatchObject({
			include: ["log:*"],
			exclude: [],
			resource: {},
			metrics: { intervalMs: 30_000 },
			delivery: {
				deliveryTimeoutMs: 5_000,
				shutdownTimeoutMs: 3_000,
				maxQueuedBatches: 50,
			},
		});
		expect(resolvedDestination.destinations).toBe(configuredDestinations);
	});

	it("allows explicit undefined cross-mode fields without changing modes", async () => {
		const push = vi.fn(() => okAsync(undefined));
		const plugin = observability({
			transports: [{ name: "legacy", push }],
			resource: undefined,
			destinations: undefined,
			metrics: undefined,
			delivery: undefined,
		});
		const state = { transports: {} };
		const result = await plugin.setup({
			eventBus: createMockEventBus(),
			logger: createMockLogger(),
			updateState: (producer: (draft: typeof state) => void) => producer(state),
		} as never);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		await result.value.disconnect?.({ type: "manual" });

		expect(
			destinationObservabilityConfigSchema.safeParse({
				destinations: [destination("logs")],
				transports: undefined,
			}).success,
		).toBe(true);
	});

	it("does not silently strip illegal mixed-mode fields", () => {
		const configuredDestination = destination("logs");
		const legacyInputs = [
			{ transports: [], resource: {} },
			{ transports: [], metrics: false },
			{ transports: [], delivery: {} },
		];
		for (const input of legacyInputs) {
			expect(observabilityConfigSchema.safeParse(input).success).toBe(false);
		}

		expect(
			observabilityConfigSchema.safeParse({
				transports: [],
				destinations: [configuredDestination],
			}).success,
		).toBe(false);
	});

	it("continues to strip unrelated unknown configuration keys", () => {
		const legacy = legacyObservabilityConfigSchema.parse({
			transports: [],
			unrelated: true,
		} as never);
		const resolvedDestination = destinationObservabilityConfigSchema.parse({
			destinations: [destination("logs")],
			unrelated: true,
		} as never);

		expect(legacy).not.toHaveProperty("unrelated");
		expect(resolvedDestination).not.toHaveProperty("unrelated");
	});

	it("preserves opaque destination objects and method factory receivers", () => {
		let factoryReceiver: unknown;
		const configuredDestination: ObservabilityDestination = {
			name: "method-factory",
			create() {
				factoryReceiver = this;
				return ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) } });
			},
		};
		const parsed = destinationObservabilityConfigSchema.parse({
			destinations: [configuredDestination] as const,
		});

		expect(parsed.destinations[0]).toBe(configuredDestination);
		expect(parsed.destinations[0]?.create).toBe(configuredDestination.create);
		parsed.destinations[0]?.create({ resourceAttributes: {} });
		expect(factoryReceiver).toBe(configuredDestination);
	});

	it("validates every destination before calling any factory", async () => {
		const create = vi.fn(() => ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) } }));
		const plugin = observability({
			destinations: [
				{ name: "valid", create },
				{ name: "invalid", create: "not-a-function" },
			],
		} as never);

		const result = await plugin.setup({} as never);
		expect(result.isErr()).toBe(true);
		expect(create).not.toHaveBeenCalled();
	});

	it("rejects blank, trim-duplicate, and prototype-mutating names", () => {
		for (const names of [["  "], ["same", " same "], ["__proto__"], [" __proto__ "]]) {
			expect(
				destinationObservabilityConfigSchema.safeParse({
					destinations: names.map(destination),
				}).success,
			).toBe(false);
		}

		expect(
			destinationObservabilityConfigSchema.safeParse({
				destinations: [destination("constructor"), destination("toString")],
			}).success,
		).toBe(true);
	});

	it("rejects removed deployment configuration with migration guidance", async () => {
		const plugin = observability({ transports: [], deployment: {} } as never);
		const result = await plugin.setup({} as never);

		expect(result.isErr()).toBe(true);
		if (result.isOk()) return;
		expect(result.error.message).toContain("use resource attributes instead");
	});
});
