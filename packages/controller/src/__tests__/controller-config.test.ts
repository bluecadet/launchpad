import { describe, expect, it } from "vitest";
import { controllerConfigSchema } from "../controller-config.js";

describe("controllerConfigSchema", () => {
	it("parses an empty config and defaults the node block to an empty object", () => {
		const config = controllerConfigSchema.parse({});
		expect(config.node).toEqual({});
	});

	it("rejects an empty node id", () => {
		expect(() => controllerConfigSchema.parse({ node: { id: "" } })).toThrow();
	});

	it("leaves the existing options untouched", () => {
		const config = controllerConfigSchema.parse({ pidFile: "./p", socketPath: "./s" });
		expect(config.pidFile).toBe("./p");
		expect(config.socketPath).toBe("./s");
	});
});
