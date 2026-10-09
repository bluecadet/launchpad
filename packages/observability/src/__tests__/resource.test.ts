import { describe, expect, it } from "vitest";
import { createResourceAttributes } from "../core/resource.js";

const deployment = {
	client: "bluecadet",
	project: "museum",
	installation: "lobby",
	environment: "production",
	attributes: { region: "us-east", floor: 2, public: true },
};

describe("createResourceAttributes", () => {
	it("creates immutable canonical resource attributes", () => {
		const attributes = createResourceAttributes(deployment);

		expect(attributes).toMatchObject({
			"service.name": "launchpad",
			"deployment.environment.name": "production",
			"launchpad.client": "bluecadet",
			"launchpad.project": "museum",
			"launchpad.installation": "lobby",
			region: "us-east",
			floor: 2,
			public: true,
		});
		expect(attributes["service.instance.id"]).toEqual(expect.any(String));
		expect(Object.isFrozen(attributes)).toBe(true);
	});

	it("generates a new service instance id for each setup", () => {
		const first = createResourceAttributes(deployment);
		const second = createResourceAttributes(deployment);

		expect(first["service.instance.id"]).not.toBe(second["service.instance.id"]);
	});

	it("does not allow extra attributes to replace canonical values", () => {
		const attributes = createResourceAttributes({
			...deployment,
			attributes: { "service.name": "other-service" },
		});

		expect(attributes["service.name"]).toBe("launchpad");
	});
});
