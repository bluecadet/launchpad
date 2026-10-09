import { describe, expect, it } from "vitest";
import {
	deliveryConfigSchema,
	deploymentConfigSchema,
	observationConfigSchema,
} from "../observability-config.js";

const deployment = {
	client: "bluecadet",
	project: "museum",
	installation: "lobby",
	environment: "production",
};

describe("deploymentConfigSchema", () => {
	it("accepts a complete deployment identity and bounded static attributes", () => {
		expect(
			deploymentConfigSchema.parse({
				...deployment,
				attributes: { region: "us-east", floor: 2, public: true },
			}),
		).toEqual({
			...deployment,
			attributes: { region: "us-east", floor: 2, public: true },
		});
	});

	it.each(["client", "project", "installation", "environment"] as const)(
		"requires a nonempty %s",
		(field) => {
			expect(deploymentConfigSchema.safeParse({ ...deployment, [field]: "  " }).success).toBe(
				false,
			);
		},
	);

	it("rejects reserved resource attributes", () => {
		const result = deploymentConfigSchema.safeParse({
			...deployment,
			attributes: { "service.name": "replacement" },
		});

		expect(result.success).toBe(false);
	});

	it("bounds the number of resource attributes", () => {
		const attributes = Object.fromEntries(
			Array.from({ length: 65 }, (_, index) => [`attribute.${index}`, index]),
		);

		expect(deploymentConfigSchema.safeParse({ ...deployment, attributes }).success).toBe(false);
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
