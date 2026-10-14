import { describe, expect, it, vi } from "vitest";
import { defineContentTransform } from "../content-transform.js";
import { createTestPluginContext } from "../transforms/__tests__/plugins.test-utils.js";

describe("ContentTransform", () => {
	it("apply() is called with the correct context shape", async () => {
		const applyFn = vi.fn();
		const transform = defineContentTransform({ name: "test-transform", apply: applyFn });
		const ctx = await createTestPluginContext();

		await transform.apply(ctx);
		expect(applyFn).toHaveBeenCalledWith(ctx);
		expect(ctx.cache).toBeDefined();
	});
});
