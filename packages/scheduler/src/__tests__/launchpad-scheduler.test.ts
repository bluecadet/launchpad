import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { describe, expect, it } from "vitest";
import { scheduler } from "../launchpad-scheduler.js";

describe("scheduler plugin", () => {
	it("validates an empty config and sets up cleanly", async () => {
		const plugin = scheduler({});
		const result = await plugin.setup(createMockPluginCtx());

		expect(result).toBeOk();
	});

	it("validates a minimal valid config", async () => {
		const plugin = scheduler({ "content.fetch": "5m" });
		const result = await plugin.setup(createMockPluginCtx());

		expect(result).toBeOk();
	});

	it("rejects an invalid config", async () => {
		const plugin = scheduler({ "content.fetch": { interval: "5m", cron: "0 3 * * *" } });
		const result = await plugin.setup(createMockPluginCtx());

		expect(result).toBeErr();
	});
});
