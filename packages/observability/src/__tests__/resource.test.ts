import { describe, expect, it } from "vitest";
import { createResourceAttributes } from "../core/resource.js";

const bluecadetResource = {
	"service.name": "museum-controller",
	"deployment.environment.name": "production",
	"launchpad.client": "bluecadet",
	"launchpad.project": "museum",
	"launchpad.installation": "lobby",
	region: "us-east",
	floor: 2,
	public: true,
};

describe("createResourceAttributes", () => {
	it("creates only the generic defaults when resource is omitted", () => {
		const attributes = createResourceAttributes();

		expect(attributes).toEqual({
			"service.name": "launchpad",
			"service.instance.id": expect.any(String),
		});
		expect(Object.isFrozen(attributes)).toBe(true);
	});

	it("preserves flat caller attributes and a service name override", () => {
		const attributes = createResourceAttributes(bluecadetResource);
		const { "service.instance.id": instanceId, ...stableAttributes } = attributes;

		expect(instanceId).toEqual(expect.any(String));
		expect(stableAttributes).toEqual(bluecadetResource);
	});

	it("generates a new service instance id for each setup", () => {
		const first = createResourceAttributes();
		const second = createResourceAttributes();

		expect(first["service.instance.id"]).not.toBe(second["service.instance.id"]);
	});

	it("uses the controller runtime id when a canonical log source provides one", () => {
		expect(createResourceAttributes({}, "runtime-123")["service.instance.id"]).toBe("runtime-123");
	});

	it("rejects a caller-owned service instance id instead of overwriting it", () => {
		expect(() => createResourceAttributes({ "service.instance.id": "caller-owned" })).toThrow(
			/service\.instance\.id/,
		);
	});
});
