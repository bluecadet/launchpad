import { ensureError } from "@bluecadet/launchpad-utils/errors";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toVisitorId, type VisitorId } from "../core/ids.js";
import { type Profile, sealProfile, unsealProfile } from "../core/profile.js";
import type {
	CredentialTap,
	TapHandler,
	Unsubscribe,
	VendorClient,
} from "../core/vendor-client.js";

/**
 * Two adapters, two completely different ways of getting a tap out of a vendor, one
 * `VendorClient`. This is the proof that the push-vs-poll unknown is absorbed by the
 * interface rather than bet on: neither adapter needed a member the other did not, and
 * neither leaked its cadence into the type.
 */

const DIRECTORY = [
	{ credential: "wristband-1", visitorId: "v-ada", language: "es", displayName: "Ada Lovelace" },
	{ credential: "wristband-2", visitorId: "v-grace", language: "en", displayName: "Grace Hopper" },
];

const POLL_INTERVAL_MS = 250;

/** What a test needs beyond the interface itself in order to drive an adapter. */
type AdapterHarness = {
	client: VendorClient;
	/** Hands the adapter a Credential the way its underlying vendor would. */
	feed(credential: string): void;
	/** Lets the adapter's own machinery run, whatever that machinery is. */
	settle(): Promise<void>;
};

// ─── Push-based adapter: taps arrive as events ──────────────────────────────

/**
 * Models a vendor SDK that emits. `subscribeTaps` is a thin wire-up over the emitter and
 * every tap reaches its handlers in the same turn it was emitted. There is no timer here
 * at all.
 */
function createPushAdapter(): AdapterHarness {
	const listeners = new Set<TapHandler>();

	function emit(credential: string): void {
		const tap: CredentialTap = { credential, observedAt: new Date() };
		for (const listener of listeners) listener(tap);
	}

	const client: VendorClient = {
		name: "push-fake",

		resolveCredential(credential) {
			const entry = DIRECTORY.find((row) => row.credential === credential);
			return okAsync(entry ? toVisitorId(entry.visitorId) : null);
		},

		fetchProfile(visitorId) {
			const entry = DIRECTORY.find((row) => row.visitorId === visitorId);
			if (!entry) return errAsync(new Error(`unknown Visitor ${visitorId}`));
			return okAsync(
				sealProfile({ data: { displayName: entry.displayName }, language: entry.language }),
			);
		},

		subscribeTaps(handler): Unsubscribe {
			listeners.add(handler);
			return () => {
				listeners.delete(handler);
			};
		},

		disconnect() {
			listeners.clear();
			return okAsync(undefined);
		},
	};

	return { client, feed: emit, settle: () => Promise.resolve() };
}

// ─── Poll-based adapter: taps are discovered by a timer ─────────────────────

/**
 * Models a vendor that only offers a "taps since last check" endpoint. The adapter owns
 * an interval, starts it when the first handler subscribes and stops it when the last one
 * leaves, and drains a queue on each tick. Its lookups go through a promise the way an
 * HTTP client's would, and it reports unknown Visitors by rejecting rather than by
 * returning an error result up front.
 */
function createPollAdapter(): AdapterHarness {
	const queue: string[] = [];
	const handlers: TapHandler[] = [];
	let timer: ReturnType<typeof setInterval> | null = null;

	function drain(): void {
		const batch = queue.splice(0, queue.length);
		for (const credential of batch) {
			const tap: CredentialTap = { credential, observedAt: new Date() };
			for (const handler of [...handlers]) handler(tap);
		}
	}

	function stopTimer(): void {
		if (timer === null) return;
		clearInterval(timer);
		timer = null;
	}

	function request<T>(produce: () => T): ResultAsync<T, Error> {
		return ResultAsync.fromPromise(Promise.resolve().then(produce), ensureError);
	}

	const client: VendorClient = {
		name: "poll-fake",

		resolveCredential(credential) {
			return request<VisitorId | null>(() => {
				const entry = DIRECTORY.find((row) => row.credential === credential);
				return entry ? toVisitorId(entry.visitorId) : null;
			});
		},

		fetchProfile(visitorId) {
			return request<Profile>(() => {
				const entry = DIRECTORY.find((row) => row.visitorId === visitorId);
				if (!entry) throw new Error(`unknown Visitor ${visitorId}`);
				return sealProfile({
					data: { displayName: entry.displayName },
					language: entry.language,
				});
			});
		},

		subscribeTaps(handler): Unsubscribe {
			handlers.push(handler);
			if (timer === null) timer = setInterval(drain, POLL_INTERVAL_MS);

			return () => {
				const index = handlers.indexOf(handler);
				if (index >= 0) handlers.splice(index, 1);
				if (handlers.length === 0) stopTimer();
			};
		},

		disconnect() {
			handlers.length = 0;
			queue.length = 0;
			stopTimer();
			return okAsync(undefined);
		},
	};

	return {
		client,
		feed: (credential) => {
			queue.push(credential);
		},
		settle: async () => {
			await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
		},
	};
}

// ─── The same behavioral suite, run against both ────────────────────────────

const ADAPTERS: ReadonlyArray<[string, () => AdapterHarness]> = [
	["push-based", createPushAdapter],
	["poll-based", createPollAdapter],
];

describe.each(ADAPTERS)("%s adapter satisfies VendorClient", (_label, createAdapter) => {
	let harness: AdapterHarness;

	beforeEach(() => {
		vi.useFakeTimers();
		harness = createAdapter();
	});

	afterEach(async () => {
		await harness.client.disconnect?.();
		vi.useRealTimers();
	});

	it("reports a name", () => {
		expect(harness.client.name).toMatch(/-fake$/);
	});

	it("delivers taps to a subscriber in order", async () => {
		const seen: string[] = [];
		harness.client.subscribeTaps((tap) => seen.push(tap.credential));

		harness.feed("wristband-1");
		harness.feed("wristband-2");
		await harness.settle();

		expect(seen).toEqual(["wristband-1", "wristband-2"]);
	});

	it("delivers each tap to every subscriber", async () => {
		const first: string[] = [];
		const second: string[] = [];
		harness.client.subscribeTaps((tap) => first.push(tap.credential));
		harness.client.subscribeTaps((tap) => second.push(tap.credential));

		harness.feed("wristband-1");
		await harness.settle();

		expect(first).toEqual(["wristband-1"]);
		expect(second).toEqual(["wristband-1"]);
	});

	it("stamps every tap with an observation time", async () => {
		const taps: CredentialTap[] = [];
		harness.client.subscribeTaps((tap) => taps.push(tap));

		harness.feed("wristband-1");
		await harness.settle();

		expect(taps[0]?.observedAt).toBeInstanceOf(Date);
	});

	it("stops delivering after unsubscribe", async () => {
		const seen: string[] = [];
		const unsubscribe = harness.client.subscribeTaps((tap) => seen.push(tap.credential));

		harness.feed("wristband-1");
		await harness.settle();
		unsubscribe();
		harness.feed("wristband-2");
		await harness.settle();

		expect(seen).toEqual(["wristband-1"]);
	});

	it("resolves a known Credential to its Visitor", async () => {
		const result = await harness.client.resolveCredential("wristband-1");

		expect(result).toBeOk();
		expect(result._unsafeUnwrap()).toBe("v-ada");
	});

	it("answers ok(null) for a Credential it does not recognize", async () => {
		const result = await harness.client.resolveCredential("someone-elses-wristband");

		expect(result).toBeOk();
		expect(result._unsafeUnwrap()).toBeNull();
	});

	it("fetches a sealed Profile carrying the canon language", async () => {
		const result = await harness.client.fetchProfile(toVisitorId("v-ada"));

		expect(result).toBeOk();
		expect(result._unsafeUnwrap().language).toBe("es");
		expect(unsealProfile(result._unsafeUnwrap())).toEqual({ displayName: "Ada Lovelace" });
	});

	it("errors on an unknown Visitor", async () => {
		expect(await harness.client.fetchProfile(toVisitorId("v-nobody"))).toBeErr();
	});

	it("disconnects cleanly", async () => {
		const result = await harness.client.disconnect?.();

		expect(result).toBeOk();
	});
});

// ─── ...and the two really are different underneath ─────────────────────────

describe("the two adapters differ in how taps arrive", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("the push adapter delivers in the same turn, with no timer running", () => {
		const harness = createPushAdapter();
		const seen: string[] = [];
		harness.client.subscribeTaps((tap) => seen.push(tap.credential));

		harness.feed("wristband-1");

		expect(seen).toEqual(["wristband-1"]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("the poll adapter delivers nothing until its own interval fires", async () => {
		const harness = createPollAdapter();
		const seen: string[] = [];
		harness.client.subscribeTaps((tap) => seen.push(tap.credential));

		harness.feed("wristband-1");
		expect(vi.getTimerCount()).toBe(1);
		expect(seen).toEqual([]);

		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
		expect(seen).toEqual([]);

		await vi.advanceTimersByTimeAsync(1);
		expect(seen).toEqual(["wristband-1"]);
	});

	it("the poll adapter stops its timer when the last subscriber leaves", () => {
		const harness = createPollAdapter();
		const unsubscribe = harness.client.subscribeTaps(() => undefined);

		expect(vi.getTimerCount()).toBe(1);
		unsubscribe();
		expect(vi.getTimerCount()).toBe(0);
	});
});
