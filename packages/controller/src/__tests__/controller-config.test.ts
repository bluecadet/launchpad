import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { controllerConfigSchema, type ResolvedControllerConfig } from "../controller-config.js";

describe("controllerConfigSchema", () => {
	it.each([undefined, {}, { logging: {} }])("resolves defaults for %j", (input) => {
		const config = controllerConfigSchema.parse(input);

		expectTypeOf(config).toEqualTypeOf<ResolvedControllerConfig>();
		expectTypeOf<undefined>().not.toExtend<ResolvedControllerConfig>();
		expectTypeOf<undefined>().toExtend<z.input<typeof controllerConfigSchema>>();
		expect(config.pidFile).toBe(".launchpad/launchpad.pid");
		expect(config.socketPath).toBe(".launchpad/launchpad.sock");
		expect(config.logging).toMatchObject({
			dirname: ".logs",
			maxSize: 8 * 1024 * 1024,
			maxFiles: 28 * 24 * 60 * 60 * 1000,
			text: { enabled: true, level: "info" },
		});
	});

	it("preserves explicit settings while resolving nested defaults", () => {
		const config = controllerConfigSchema.parse({
			pidFile: "custom.pid",
			socketPath: "custom.sock",
			logging: { dirname: "custom-logs", text: { enabled: false } },
		});

		expect(config).toMatchObject({
			pidFile: "custom.pid",
			socketPath: "custom.sock",
			logging: { dirname: "custom-logs", text: { enabled: false, level: "info" } },
		});
	});
});
