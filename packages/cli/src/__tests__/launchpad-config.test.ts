import type { ResolvedControllerConfig } from "@bluecadet/launchpad-controller/config";
import { describe, expect, expectTypeOf, it } from "vitest";
import { launchpadConfigSchema, resolveLaunchpadConfig } from "../launchpad-config.js";

describe("launchpadConfigSchema", () => {
	it.each([{}, { controller: undefined }, { controller: {} }])(
		"always resolves controller settings for %j",
		(input) => {
			const config = resolveLaunchpadConfig(input);

			expectTypeOf(config.controller).toEqualTypeOf<ResolvedControllerConfig>();
			expect(config.controller.pidFile).toBe(".launchpad/launchpad.pid");
			expect(config.controller.socketPath).toBe(".launchpad/launchpad.sock");
			expect(config.controller.logging.dirname).toBe(".logs");
		},
	);

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

	it("accepts stopOnError step objects", () => {
		const config = resolveLaunchpadConfig({
			workflows: {
				deploy: [{ step: "content.fetch", stopOnError: true }, "monitor.start"],
			},
		});

		expect(config.workflows).toEqual({
			deploy: [{ step: "content.fetch", stopOnError: true }, "monitor.start"],
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
