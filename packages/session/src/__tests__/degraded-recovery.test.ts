import { beforeEach, describe, expect, it } from "vitest";
import { newSessionId } from "../core/ids.js";
import type { Session } from "../core/session.js";
import type { VendorClient } from "../core/vendor-client.js";
import { fakeVendor } from "../vendors/fake.js";

/**
 * Stand-in for the session broker (built in a later issue) — just enough of one to prove
 * a tap can be scripted end to end against the fake with no network. It consumes nothing
 * but the `VendorClient` duck-type.
 */
function createStationBroker(vendor: VendorClient, fallbackLanguage = "en") {
	let seq = 0;
	let session: Session | null = null;
	let pending: Promise<void> = Promise.resolve();

	async function openSession(credential: string): Promise<void> {
		const resolved = await vendor.resolveCredential(credential);
		if (resolved.isErr() || resolved.value === null) {
			session = null;
			return;
		}

		const profile = await vendor.fetchProfile(resolved.value);
		seq += 1;
		session = {
			sessionId: newSessionId(),
			visitorId: resolved.value,
			language: profile.isOk() ? (profile.value.language ?? fallbackLanguage) : fallbackLanguage,
			degraded: profile.isErr(),
			seq,
		};
	}

	const unsubscribe = vendor.subscribeTaps((tap) => {
		pending = pending.then(() => openSession(tap.credential));
	});

	return {
		/** Resolves once every tap taken so far has been serviced. */
		idle: () => pending,
		current: (): Session | null => session,
		unsubscribe,
	};
}

describe("tap, degraded fallback, and recovery", () => {
	let vendor: ReturnType<typeof fakeVendor>;
	let broker: ReturnType<typeof createStationBroker>;

	beforeEach(() => {
		vendor = fakeVendor({
			visitors: {
				"wristband-1": {
					visitorId: "v-ada",
					language: "es",
					profile: { displayName: "Ada Lovelace", membership: "patron" },
				},
			},
			unlistedCredentials: "unresolved",
		});
		broker = createStationBroker(vendor);
	});

	it("opens a Session from a scripted tap", async () => {
		vendor.tap("wristband-1");
		await broker.idle();

		expect(broker.current()).toMatchObject({
			visitorId: "v-ada",
			language: "es",
			degraded: false,
			seq: 1,
		});
	});

	it("falls back to a degraded Session when the Profile lookup fails", async () => {
		vendor.tap("wristband-1");
		await broker.idle();

		vendor.injectFault({ call: "fetchProfile", message: "vendor unreachable" });
		vendor.tap("wristband-1");
		await broker.idle();

		expect(broker.current()).toMatchObject({
			visitorId: "v-ada",
			language: "en",
			degraded: true,
			seq: 2,
		});
	});

	it("recovers a full Session once the vendor comes back", async () => {
		vendor.injectFault({ call: "fetchProfile", times: 1 });

		vendor.tap("wristband-1");
		await broker.idle();
		expect(broker.current()?.degraded).toBe(true);

		vendor.tap("wristband-1");
		await broker.idle();

		expect(broker.current()).toMatchObject({
			language: "es",
			degraded: false,
			seq: 2,
		});
	});

	it("keeps seq monotonic across the whole scenario", async () => {
		const seqs: number[] = [];

		vendor.tap("wristband-1");
		await broker.idle();
		seqs.push(broker.current()?.seq ?? -1);

		vendor.injectFault({ call: "fetchProfile" });
		vendor.tap("wristband-1");
		await broker.idle();
		seqs.push(broker.current()?.seq ?? -1);

		vendor.clearFaults();
		vendor.tap("wristband-1");
		await broker.idle();
		seqs.push(broker.current()?.seq ?? -1);

		expect(seqs).toEqual([1, 2, 3]);
	});

	it("opens no Session when the vendor does not recognize the Credential", async () => {
		vendor.tap("someone-elses-wristband");
		await broker.idle();

		expect(broker.current()).toBeNull();
	});

	it("keeps the Profile out of the canon that reaches state and events", async () => {
		vendor.tap("wristband-1");
		await broker.idle();

		const canon = JSON.stringify(broker.current());
		expect(canon).not.toContain("Ada Lovelace");
		expect(canon).not.toContain("patron");
	});

	it("stops opening Sessions once the broker unsubscribes", async () => {
		broker.unsubscribe();
		vendor.tap("wristband-1");
		await broker.idle();

		expect(broker.current()).toBeNull();
		expect(vendor.calls).toHaveLength(0);
	});
});
