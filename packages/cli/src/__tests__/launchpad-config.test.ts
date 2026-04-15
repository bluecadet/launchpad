import { describe, expect, it } from "vitest";
import { launchpadConfigSchema, resolveLaunchpadConfig } from "../launchpad-config.js";

describe("launchpadConfigSchema", () => {
	it("accepts string and object workflow steps", () => {
		const config = resolveLaunchpadConfig({
			workflows: {
				start: ["content.fetch", { type: "monitor.start", appNames: ["api"] }],
				stop: ["monitor.stop", "monitor.disconnect"],
			},
		});

		expect(config.workflows).toEqual({
			start: ["content.fetch", { type: "monitor.start", appNames: ["api"] }],
			stop: ["monitor.stop", "monitor.disconnect"],
		});
	});

	it("defaults workflows to an empty object", () => {
		const config = resolveLaunchpadConfig({});

		expect(config.workflows).toEqual({});
	});

	it("rejects invalid string workflow steps", () => {
		expect(() =>
			launchpadConfigSchema.parse({
				workflows: {
					start: ["invalid-command"],
				},
			}),
		).toThrow();
	});
});
