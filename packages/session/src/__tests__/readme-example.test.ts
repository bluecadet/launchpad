import { describe, expect, it } from "vitest";
import { fakeVendor, unsealProfile } from "../index.js";

describe("README example", () => {
	it("runs as written", async () => {
		const opened: Array<[string, Record<string, unknown>]> = [];
		const degraded: number[] = [];
		const app = {
			open: (language: string, profile: Record<string, unknown>) => {
				opened.push([language, profile]);
			},
			degrade: () => {
				degraded.push(1);
			},
		};

		const vendor = fakeVendor({
			visitors: {
				"wristband-1": { visitorId: "v-ada", language: "es", profile: { displayName: "Ada" } },
			},
		});

		async function openSession(credential: string): Promise<void> {
			const resolved = await vendor.resolveCredential(credential);
			if (resolved.isErr()) return app.degrade();
			if (resolved.value === null) return;

			const profile = await vendor.fetchProfile(resolved.value);
			if (profile.isErr()) return app.degrade();

			app.open(profile.value.language ?? "en", unsealProfile(profile.value));
		}

		let pending = Promise.resolve();
		vendor.subscribeTaps((tap) => {
			pending = pending.then(() => openSession(tap.credential));
		});

		vendor.tap("wristband-1");
		await pending;

		expect(opened).toEqual([["es", { displayName: "Ada" }]]);
		expect(degraded).toEqual([]);
	});
});
