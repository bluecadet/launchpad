import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toVisitorId } from "../core/ids.js";
import { unsealProfile } from "../core/profile.js";
import type { CredentialTap } from "../core/vendor-client.js";
import { fakeVendor } from "../vendors/fake.js";

const DIRECTORY = {
	"wristband-1": {
		visitorId: "v-ada",
		language: "es",
		profile: { displayName: "Ada Lovelace", visitCount: 4 },
	},
	"wristband-2": { visitorId: "v-grace", language: "en" },
};

describe("fakeVendor", () => {
	describe("identity", () => {
		it('names itself "fake" by default', () => {
			expect(fakeVendor().name).toBe("fake");
		});

		it("takes a configured name, so two fakes can be told apart in state", () => {
			expect(fakeVendor({ name: "lobby-vendor" }).name).toBe("lobby-vendor");
		});
	});

	describe("resolveCredential", () => {
		it("resolves a listed Credential to its configured Visitor", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			const result = await vendor.resolveCredential("wristband-1");

			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBe("v-ada");
		});

		it("derives a stable Visitor for an unlisted Credential", async () => {
			const first = await fakeVendor().resolveCredential("unlisted");
			const second = await fakeVendor().resolveCredential("unlisted");

			expect(first._unsafeUnwrap()).toBe(second._unsafeUnwrap());
			expect(first._unsafeUnwrap()).toMatch(/^visitor-[0-9a-f]{8}$/);
		});

		it("derives different Visitors under different seeds", async () => {
			const a = await fakeVendor({ seed: 1 }).resolveCredential("unlisted");
			const b = await fakeVendor({ seed: 2 }).resolveCredential("unlisted");

			expect(a._unsafeUnwrap()).not.toBe(b._unsafeUnwrap());
		});

		it('answers ok(null) for an unlisted Credential when configured "unresolved"', async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY, unlistedCredentials: "unresolved" });
			const result = await vendor.resolveCredential("someone-elses-wristband");

			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBeNull();
		});
	});

	describe("fetchProfile", () => {
		it("returns the configured Profile contents, exactly", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			const result = await vendor.fetchProfile(toVisitorId("v-ada"));

			expect(result).toBeOk();
			expect(unsealProfile(result._unsafeUnwrap())).toEqual({
				displayName: "Ada Lovelace",
				visitCount: 4,
			});
		});

		it("lifts the configured language onto the Profile", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			const result = await vendor.fetchProfile(toVisitorId("v-ada"));

			expect(result._unsafeUnwrap().language).toBe("es");
		});

		it("derives a reproducible Profile for a derived Visitor", async () => {
			const vendor = fakeVendor({ seed: 7 });
			const visitorId = (await vendor.resolveCredential("wristband-9"))._unsafeUnwrap()!;
			const first = await vendor.fetchProfile(visitorId);
			const second = await fakeVendor({ seed: 7 }).fetchProfile(visitorId);

			expect(unsealProfile(first._unsafeUnwrap())).toEqual(unsealProfile(second._unsafeUnwrap()));
			expect(unsealProfile(first._unsafeUnwrap())).toHaveProperty("displayName");
		});

		it("draws derived languages from the configured pool", async () => {
			const vendor = fakeVendor({ languages: ["cy"] });
			const result = await vendor.fetchProfile(toVisitorId("anyone"));

			expect(result._unsafeUnwrap().language).toBe("cy");
		});
	});

	describe("fault injection", () => {
		it("fails a call while a fault is active", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			vendor.injectFault({ call: "resolveCredential", message: "vendor offline" });

			const result = await vendor.resolveCredential("wristband-1");

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toBe("vendor offline");
		});

		it("recovers on its own after the configured number of failures", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			vendor.injectFault({ call: "fetchProfile", times: 2 });

			expect(await vendor.fetchProfile(toVisitorId("v-ada"))).toBeErr();
			expect(await vendor.fetchProfile(toVisitorId("v-ada"))).toBeErr();
			expect(await vendor.fetchProfile(toVisitorId("v-ada"))).toBeOk();
		});

		it("keeps failing until cleared when no count is given", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			vendor.injectFault({ call: "fetchProfile" });

			expect(await vendor.fetchProfile(toVisitorId("v-ada"))).toBeErr();
			expect(await vendor.fetchProfile(toVisitorId("v-ada"))).toBeErr();

			vendor.clearFaults();
			expect(await vendor.fetchProfile(toVisitorId("v-ada"))).toBeOk();
		});

		it("targets one call without disturbing the other", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			vendor.injectFault({ call: "fetchProfile" });

			expect(await vendor.resolveCredential("wristband-1")).toBeOk();
			expect(await vendor.fetchProfile(toVisitorId("v-ada"))).toBeErr();
		});

		it("accepts faults declared in config", async () => {
			const vendor = fakeVendor({
				visitors: DIRECTORY,
				faults: [{ call: "resolveCredential", message: "cold start" }],
			});

			expect((await vendor.resolveCredential("wristband-1"))._unsafeUnwrapErr().message).toBe(
				"cold start",
			);
		});
	});

	describe("latency and cancellation", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("holds a call open for the configured latency", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY, latencyMs: { resolveCredential: 500 } });
			let settled = false;
			const pending = vendor.resolveCredential("wristband-1").map((value) => {
				settled = true;
				return value;
			});

			await vi.advanceTimersByTimeAsync(499);
			expect(settled).toBe(false);

			await vi.advanceTimersByTimeAsync(1);
			expect(await pending).toBeOk();
			expect(settled).toBe(true);
		});

		it("errors immediately when aborted mid-flight, without waiting out the latency", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY, latencyMs: { fetchProfile: 10_000 } });
			const controller = new AbortController();

			const pending = vendor.fetchProfile(toVisitorId("v-ada"), { signal: controller.signal });
			controller.abort(new Error("caller gave up"));

			// No timer advance: if the fake ran its latency to completion this would hang.
			const result = await pending;

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toBe("caller gave up");
			expect(vi.getTimerCount()).toBe(0);
		});

		it("errors on a signal that was already aborted", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY, latencyMs: { fetchProfile: 10_000 } });
			const result = await vendor.fetchProfile(toVisitorId("v-ada"), {
				signal: AbortSignal.abort(new Error("stale request")),
			});

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toBe("stale request");
		});

		it("does not consume a fault when the call is aborted first", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY, latencyMs: { fetchProfile: 1000 } });
			vendor.injectFault({ call: "fetchProfile", times: 1 });
			const controller = new AbortController();

			const aborted = vendor.fetchProfile(toVisitorId("v-ada"), { signal: controller.signal });
			controller.abort();
			expect(await aborted).toBeErr();

			// The one injected failure is still waiting for a call that actually ran.
			const second = vendor.fetchProfile(toVisitorId("v-ada"));
			await vi.advanceTimersByTimeAsync(1000);
			expect(await second).toBeErr();

			const third = vendor.fetchProfile(toVisitorId("v-ada"));
			await vi.advanceTimersByTimeAsync(1000);
			expect(await third).toBeOk();
		});
	});

	describe("tap scripting", () => {
		it("delivers a tap to every subscriber", () => {
			const vendor = fakeVendor();
			const first: CredentialTap[] = [];
			const second: CredentialTap[] = [];
			vendor.subscribeTaps((tap) => first.push(tap));
			vendor.subscribeTaps((tap) => second.push(tap));

			vendor.tap("wristband-1");

			expect(first.map((tap) => tap.credential)).toEqual(["wristband-1"]);
			expect(second.map((tap) => tap.credential)).toEqual(["wristband-1"]);
		});

		it("stamps the tap with the given observation time", () => {
			const vendor = fakeVendor();
			const observedAt = new Date("2026-03-01T12:00:00.000Z");

			expect(vendor.tap("wristband-1", { observedAt }).observedAt).toBe(observedAt);
		});

		it("stops delivering once unsubscribed", () => {
			const vendor = fakeVendor();
			const seen: string[] = [];
			const unsubscribe = vendor.subscribeTaps((tap) => seen.push(tap.credential));

			vendor.tap("wristband-1");
			unsubscribe();
			vendor.tap("wristband-2");

			expect(seen).toEqual(["wristband-1"]);
		});

		it("tolerates unsubscribing twice", () => {
			const vendor = fakeVendor();
			const unsubscribe = vendor.subscribeTaps(() => undefined);

			unsubscribe();
			expect(() => unsubscribe()).not.toThrow();
			expect(vendor.subscriberCount).toBe(0);
		});

		it("plays a scripted run of taps in order", async () => {
			const vendor = fakeVendor();
			const seen: string[] = [];
			vendor.subscribeTaps((tap) => seen.push(tap.credential));

			await vendor.tapSequence(["a", "b", "c"]);

			expect(seen).toEqual(["a", "b", "c"]);
		});

		it("paces a scripted run when given an interval", async () => {
			vi.useFakeTimers();
			const vendor = fakeVendor();
			const seen: string[] = [];
			vendor.subscribeTaps((tap) => seen.push(tap.credential));

			const played = vendor.tapSequence(["a", "b"], { intervalMs: 1000 });
			await vi.advanceTimersByTimeAsync(0);
			expect(seen).toEqual(["a"]);

			await vi.advanceTimersByTimeAsync(1000);
			await played;
			expect(seen).toEqual(["a", "b"]);
			vi.useRealTimers();
		});
	});

	describe("bookkeeping", () => {
		it("reports how many handlers are subscribed", () => {
			const vendor = fakeVendor();
			expect(vendor.subscriberCount).toBe(0);

			vendor.subscribeTaps(() => undefined);
			vendor.subscribeTaps(() => undefined);
			expect(vendor.subscriberCount).toBe(2);
		});

		it("records every call in order", async () => {
			const vendor = fakeVendor({ visitors: DIRECTORY });
			await vendor.resolveCredential("wristband-1");
			await vendor.fetchProfile(toVisitorId("v-ada"));

			expect(vendor.calls).toEqual([
				{ call: "resolveCredential", credential: "wristband-1" },
				{ call: "fetchProfile", visitorId: "v-ada" },
			]);
		});

		it("drops every subscriber on disconnect", async () => {
			const vendor = fakeVendor();
			vendor.subscribeTaps(() => undefined);

			const disconnected = await vendor.disconnect!();

			expect(disconnected).toBeOk();
			expect(vendor.subscriberCount).toBe(0);
		});
	});

	describe("config validation", () => {
		it("rejects an unknown fault target", () => {
			expect(() => fakeVendor({ faults: [{ call: "listTaps" as never }] })).toThrow();
		});

		it("rejects a negative latency", () => {
			expect(() => fakeVendor({ latencyMs: { resolveCredential: -1 } })).toThrow();
		});
	});
});
