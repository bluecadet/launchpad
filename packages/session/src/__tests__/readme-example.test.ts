import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { describe, expect, it } from "vitest";
import { fakeVendor, session } from "../index.js";
import type { SessionCurrentResult } from "../session-commands.js";

describe("README example", () => {
	it("runs as written", async () => {
		// The config file's `plugins` entry, lifted out of `defineConfig`.
		const plugin = session({
			vendor: fakeVendor({
				visitors: {
					"wristband-1": { visitorId: "v-ada", language: "es", profile: { displayName: "Ada" } },
				},
			}),
			idleTimeoutMs: 90_000,
		});

		const setup = await plugin.setup(createMockPluginCtx());
		expect(setup).toBeOk();
		if (setup.isErr()) return;

		const tapped = await setup.value.executeCommand?.({
			type: "session.tap.simulate",
			credential: "wristband-1",
		});
		expect(tapped).toBeOk();

		const queried = await setup.value.executeCommand?.({ type: "session.current" });
		expect(queried).toBeOk();
		if (queried === undefined || queried.isErr()) return;

		const result = queried.value as SessionCurrentResult;
		expect(result.session).toMatchObject({ visitorId: "v-ada", language: "es", degraded: false });
		expect(result.profile).toEqual({ displayName: "Ada" });
	});
});
