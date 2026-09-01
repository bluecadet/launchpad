import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toVisitorId, type VisitorId } from "../core/ids.js";
import { type Profile, sealProfile } from "../core/profile.js";
import type { TapHandler, VendorClient } from "../core/vendor-client.js";
import { session } from "../launchpad-session.js";
import type {
	SessionCurrentResult,
	SessionEndResult,
	SessionTapSimulateResult,
} from "../session-commands.js";
import type { SessionState } from "../session-state.js";
import { type FakeVendor, fakeVendor } from "../vendors/fake.js";

/** Lets every already-resolved vendor promise settle, the way a real tap would. */
function flushTaps(): Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

function createVendor(): FakeVendor {
	return fakeVendor({
		visitors: {
			"wristband-ada": {
				visitorId: "v-ada",
				language: "es",
				profile: { displayName: "Ada Lovelace", membership: "patron" },
			},
			"wristband-grace": {
				visitorId: "v-grace",
				language: "fr",
				profile: { displayName: "Grace Hopper" },
			},
		},
		unlistedCredentials: "unresolved",
	});
}

/**
 * Mirrors what the controller does with `updateState`: keeps the plugin's slice so a
 * test can assert on what reached the state store.
 */
function createStateSpy() {
	let state: SessionState = { current: null, degraded: false };
	let writes = 0;
	return {
		updateState: (producer: (draft: SessionState) => void) => {
			const draft = { ...state };
			producer(draft);
			state = draft;
			writes += 1;
		},
		read: () => state,
		writes: () => writes,
	};
}

type Broker = {
	ctx: ReturnType<typeof createMockPluginCtx>;
	state: ReturnType<typeof createStateSpy>;
	execute: (command: Record<string, unknown>) => Promise<unknown>;
	disconnect: () => Promise<void>;
	emitted: (name: string) => unknown[];
	eventNames: () => string[];
};

type Harness = Broker & { vendor: FakeVendor };

type SetupOptions = { idleTimeoutMs?: number; fallbackLanguage?: string };

async function setupBroker(vendor: VendorClient, options?: SetupOptions): Promise<Broker> {
	const state = createStateSpy();
	const ctx = createMockPluginCtx("/", { updateState: state.updateState });

	const plugin = session({
		vendor,
		...(options?.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
		...(options?.fallbackLanguage === undefined
			? {}
			: { fallbackLanguage: options.fallbackLanguage }),
	});
	const result = await plugin.setup(ctx);
	if (result.isErr()) throw result.error;
	const instance = result.value;

	return {
		ctx,
		state,
		execute: async (command) => {
			const outcome = await instance.executeCommand?.(command as never);
			if (outcome === undefined) throw new Error("plugin does not execute commands");
			if (outcome.isErr()) throw outcome.error;
			return outcome.value;
		},
		disconnect: async () => {
			await instance.disconnect?.({ type: "manual" });
		},
		emitted: (name) => ctx.eventBus.getEventsOfType(name),
		eventNames: () => ctx.eventBus.getEmittedEvents().map((entry) => entry.event),
	};
}

async function setupSession(options?: SetupOptions): Promise<Harness> {
	const vendor = createVendor();
	return { ...(await setupBroker(vendor, options)), vendor };
}

/**
 * A vendor that answers only when the test says so. Holding a lookup open is the only
 * way to reproduce the orderings that matter: a resolve landing behind a later tap,
 * behind an idle timeout, behind `session.end`, or behind a disconnect.
 */
function createDeferredVendor(options?: { deferProfiles?: boolean }) {
	const credentialCalls: Array<(visitorId: VisitorId | null) => void> = [];
	const profileCalls: Array<() => void> = [];
	const handlers = new Set<TapHandler>();

	const vendor: VendorClient = {
		name: "deferred",
		resolveCredential() {
			return ResultAsync.fromSafePromise(
				new Promise<VisitorId | null>((resolve) => {
					credentialCalls.push(resolve);
				}),
			);
		},
		fetchProfile(visitorId) {
			const profile = sealProfile({ data: { visitor: visitorId }, language: "en" });
			if (options?.deferProfiles !== true) return okAsync(profile);
			return ResultAsync.fromSafePromise(
				new Promise<Profile>((resolve) => {
					profileCalls.push(() => {
						resolve(profile);
					});
				}),
			);
		},
		subscribeTaps(handler) {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
	};

	return {
		vendor,
		tap: (credential: string) => {
			for (const handler of handlers) handler({ credential, observedAt: new Date() });
		},
		/** Answers the nth `resolveCredential` call, oldest first. */
		answerCredential: (index: number, visitorId: string | null) => {
			credentialCalls[index]?.(visitorId === null ? null : toVisitorId(visitorId));
		},
		/** Answers the nth `fetchProfile` call. Only meaningful with `deferProfiles`. */
		answerProfile: (index: number) => {
			profileCalls[index]?.();
		},
	};
}

describe("session plugin", () => {
	describe("configuration", () => {
		it("sets up with a vendor and nothing else", async () => {
			const plugin = session({ vendor: fakeVendor() });

			await expect(plugin.setup(createMockPluginCtx())).resolves.toBeOk();
		});

		it("rejects a value that is not a VendorClient", async () => {
			const plugin = session({ vendor: { name: "broken" } as never });

			await expect(plugin.setup(createMockPluginCtx())).resolves.toBeErr();
		});

		it("rejects a non-positive idle timeout", async () => {
			const plugin = session({ vendor: fakeVendor(), idleTimeoutMs: 0 });

			await expect(plugin.setup(createMockPluginCtx())).resolves.toBeErr();
		});

		it("subscribes to the vendor's taps", async () => {
			const harness = await setupSession();

			expect(harness.vendor.subscriberCount).toBe(1);
		});

		it("publishes an idle slice before the first tap", async () => {
			const harness = await setupSession();

			expect(harness.state.read()).toEqual({ current: null, degraded: false });
		});
	});

	describe("tap to render", () => {
		let harness: Harness;

		beforeEach(async () => {
			harness = await setupSession();
		});

		it("opens a Session from a vendor tap", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(harness.state.read().current).toMatchObject({
				visitorId: "v-ada",
				language: "es",
				degraded: false,
				seq: 1,
			});
		});

		it("emits started and current for the new Session", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(harness.eventNames()).toEqual(["session:started", "session:current"]);
		});

		it("hands the app the Session and the Profile behind it", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			const result = (await harness.execute({ type: "session.current" })) as SessionCurrentResult;

			expect(result.session).toMatchObject({ visitorId: "v-ada", language: "es" });
			expect(result.profile).toEqual({ displayName: "Ada Lovelace", membership: "patron" });
		});

		it("keeps the Profile out of every event payload", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			const serialized = JSON.stringify(harness.ctx.eventBus.getEmittedEvents());

			expect(serialized).not.toContain("Ada Lovelace");
			expect(serialized).not.toContain("patron");
		});

		it("keeps the Profile out of the state store", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(JSON.stringify(harness.state.read())).not.toContain("Ada Lovelace");
		});

		it("refreshes in place when the same Credential taps again", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();
			const first = harness.state.read().current?.sessionId;

			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(harness.state.read().current).toMatchObject({ sessionId: first, seq: 2 });
			expect(harness.emitted("session:started")).toHaveLength(1);
			expect(harness.emitted("session:ended")).toHaveLength(0);
		});

		it("replaces the Session when a different Credential taps", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();
			harness.vendor.tap("wristband-grace");
			await flushTaps();

			expect(harness.eventNames()).toEqual([
				"session:started",
				"session:current",
				"session:ended",
				"session:started",
				"session:current",
			]);
			expect(harness.emitted("session:ended")[0]).toMatchObject({ reason: "replaced" });
			expect(harness.state.read().current).toMatchObject({ visitorId: "v-grace", language: "fr" });
		});

		it("swaps the Profile passthrough along with the Session", async () => {
			harness.vendor.tap("wristband-ada");
			await flushTaps();
			harness.vendor.tap("wristband-grace");
			await flushTaps();

			const result = (await harness.execute({ type: "session.current" })) as SessionCurrentResult;

			expect(result.profile).toEqual({ displayName: "Grace Hopper" });
		});

		it("ignores a Credential the vendor does not recognize", async () => {
			harness.vendor.tap("someone-elses-wristband");
			await flushTaps();

			expect(harness.state.read().current).toBeNull();
			expect(harness.eventNames()).toEqual([]);
		});
	});

	describe("idle timeout", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("ends the Session once the timeout elapses", async () => {
			const harness = await setupSession({ idleTimeoutMs: 5_000 });
			harness.vendor.tap("wristband-ada");
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(5_000);

			expect(harness.state.read().current).toBeNull();
			expect(harness.emitted("session:ended")[0]).toMatchObject({ reason: "timeout" });
		});

		it("pushes the deadline out on a re-tap", async () => {
			const harness = await setupSession({ idleTimeoutMs: 5_000 });
			harness.vendor.tap("wristband-ada");
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(4_000);
			harness.vendor.tap("wristband-ada");
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(4_000);

			expect(harness.state.read().current).not.toBeNull();
		});

		it("lets a lookup that outlived the timeout open the next Session", async () => {
			const deferred = createDeferredVendor();
			const harness = await setupBroker(deferred.vendor, { idleTimeoutMs: 5_000 });

			deferred.tap("wristband-1");
			deferred.answerCredential(0, "v-ada");
			await vi.advanceTimersByTimeAsync(0);

			deferred.tap("wristband-2");
			await vi.advanceTimersByTimeAsync(5_000);
			expect(harness.emitted("session:ended")[0]).toMatchObject({ reason: "timeout" });

			deferred.answerCredential(1, "v-grace");
			await vi.advanceTimersByTimeAsync(0);

			expect(harness.state.read().current).toMatchObject({ visitorId: "v-grace" });
		});

		it("stops the timer on disconnect", async () => {
			const harness = await setupSession({ idleTimeoutMs: 5_000 });
			harness.vendor.tap("wristband-ada");
			await vi.advanceTimersByTimeAsync(0);

			await harness.disconnect();
			await vi.advanceTimersByTimeAsync(60_000);

			expect(harness.emitted("session:ended")).toHaveLength(0);
		});
	});

	describe("commands", () => {
		it("answers session.current with nulls while the Station is idle", async () => {
			const harness = await setupSession();

			await expect(harness.execute({ type: "session.current" })).resolves.toEqual({
				session: null,
				profile: null,
			});
		});

		it("ends the Session on session.end", async () => {
			const harness = await setupSession();
			harness.vendor.tap("wristband-ada");
			await flushTaps();
			const sessionId = harness.state.read().current?.sessionId;

			const result = (await harness.execute({ type: "session.end" })) as SessionEndResult;

			expect(result).toEqual({ ended: true, sessionId });
			expect(harness.emitted("session:ended")[0]).toMatchObject({ reason: "explicit" });
			expect(harness.state.read().current).toBeNull();
		});

		it("answers session.end with ok and ended:false when already idle", async () => {
			const harness = await setupSession();

			await expect(harness.execute({ type: "session.end" })).resolves.toEqual({
				ended: false,
				sessionId: null,
			});
			expect(harness.eventNames()).toEqual([]);
		});

		it("drops the Profile passthrough when the Session ends", async () => {
			const harness = await setupSession();
			harness.vendor.tap("wristband-ada");
			await flushTaps();
			await harness.execute({ type: "session.end" });

			const result = (await harness.execute({ type: "session.current" })) as SessionCurrentResult;

			expect(result.profile).toBeNull();
		});

		it("opens a Session from session.tap.simulate", async () => {
			const harness = await setupSession();

			const result = (await harness.execute({
				type: "session.tap.simulate",
				credential: "wristband-ada",
			})) as SessionTapSimulateResult;

			expect(result.accepted).toBe(true);
			expect(result.session).toMatchObject({ visitorId: "v-ada", language: "es" });
			expect(harness.emitted("session:started")).toHaveLength(1);
		});

		it("reports an unrecognized Credential as not accepted", async () => {
			const harness = await setupSession();

			await expect(
				harness.execute({ type: "session.tap.simulate", credential: "someone-else" }),
			).resolves.toEqual({ accepted: false, session: null });
		});

		it("does not let a lookup in flight re-open a Session after session.end", async () => {
			const deferred = createDeferredVendor();
			const harness = await setupBroker(deferred.vendor);

			deferred.tap("wristband-1");
			deferred.answerCredential(0, "v-ada");
			await flushTaps();

			deferred.tap("wristband-2");
			const ended = await harness.execute({ type: "session.end" });
			expect(ended).toMatchObject({ ended: true });

			deferred.answerCredential(1, "v-grace");
			await flushTaps();

			expect(harness.state.read().current).toBeNull();
			expect(harness.emitted("session:started")).toHaveLength(1);
		});

		it("rejects a malformed command", async () => {
			const harness = await setupSession();

			await expect(harness.execute({ type: "session.tap.simulate" })).rejects.toThrow(
				/Invalid command/,
			);
		});
	});

	describe("degraded mode", () => {
		it("opens a degraded Session on the fallback language when no Profile is cached", async () => {
			const harness = await setupSession({ fallbackLanguage: "en" });
			harness.vendor.injectFault({ call: "fetchProfile" });

			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(harness.state.read()).toEqual({
				current: expect.objectContaining({ visitorId: "v-ada", language: "en", degraded: true }),
				degraded: true,
			});
		});

		it("serves a cached Visitor's language and Profile through the outage", async () => {
			const harness = await setupSession();
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			harness.vendor.injectFault({ call: "fetchProfile" });
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			const result = (await harness.execute({ type: "session.current" })) as SessionCurrentResult;

			expect(result.session).toMatchObject({ language: "es", degraded: true });
			expect(result.profile).toEqual({ displayName: "Ada Lovelace", membership: "patron" });
		});

		it("announces the transition into degraded exactly once", async () => {
			const harness = await setupSession();
			harness.vendor.injectFault({ call: "fetchProfile" });

			harness.vendor.tap("wristband-ada");
			await flushTaps();
			harness.vendor.tap("wristband-grace");
			await flushTaps();

			expect(harness.emitted("session:degraded")).toEqual([{ degraded: true }]);
		});

		it("announces recovery once the vendor answers again", async () => {
			const harness = await setupSession();
			harness.vendor.injectFault({ call: "fetchProfile", times: 1 });

			harness.vendor.tap("wristband-ada");
			await flushTaps();
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(harness.emitted("session:degraded")).toEqual([
				{ degraded: true },
				{ degraded: false },
			]);
			expect(harness.state.read()).toEqual({
				current: expect.objectContaining({ language: "es", degraded: false, seq: 2 }),
				degraded: false,
			});
		});

		it("drops the tap when the Credential itself cannot be resolved", async () => {
			const harness = await setupSession();
			harness.vendor.injectFault({ call: "resolveCredential" });

			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(harness.state.read()).toEqual({ current: null, degraded: true });
			expect(harness.emitted("session:started")).toHaveLength(0);
		});
	});

	describe("concurrent taps", () => {
		it("lets the later tap win even when the earlier lookup lands last", async () => {
			const deferred = createDeferredVendor();
			const harness = await setupBroker(deferred.vendor);

			deferred.tap("first");
			deferred.tap("second");
			deferred.answerCredential(1, "v-second");
			await flushTaps();
			deferred.answerCredential(0, "v-first");
			await flushTaps();

			expect(harness.state.read().current).toMatchObject({ visitorId: "v-second", seq: 1 });
		});

		it("refreshes rather than restarting when a re-tap overtakes the first lookup", async () => {
			const deferred = createDeferredVendor();
			const harness = await setupBroker(deferred.vendor);

			deferred.tap("wristband-1");
			deferred.tap("wristband-1");
			deferred.answerCredential(1, "v-ada");
			await flushTaps();
			deferred.answerCredential(0, "v-ada");
			await flushTaps();

			expect(harness.emitted("session:started")).toHaveLength(1);
			expect(harness.emitted("session:ended")).toHaveLength(0);
			expect(harness.state.read().current).toMatchObject({ visitorId: "v-ada", seq: 1 });
		});

		it("ignores a stale failure once a newer lookup has already succeeded", async () => {
			const deferred = createDeferredVendor({ deferProfiles: true });
			const harness = await setupBroker(deferred.vendor);

			deferred.tap("first");
			deferred.tap("second");
			deferred.answerCredential(0, "v-first");
			deferred.answerCredential(1, "v-second");
			await flushTaps();

			// The newer tap's Profile lands first; the older one is still outstanding and
			// will never be answered, which is how a real lookup fails after a timeout.
			deferred.answerProfile(1);
			await flushTaps();

			expect(harness.state.read()).toEqual({
				current: expect.objectContaining({ visitorId: "v-second" }),
				degraded: false,
			});
			expect(harness.emitted("session:degraded")).toEqual([]);
		});

		it("does not resurrect a Credential a later tap already replaced", async () => {
			const deferred = createDeferredVendor();
			const harness = await setupBroker(deferred.vendor);

			deferred.tap("first");
			deferred.tap("second");
			deferred.answerCredential(1, "v-second");
			await flushTaps();
			deferred.answerCredential(0, "v-first");
			await flushTaps();

			const result = (await harness.execute({ type: "session.current" })) as SessionCurrentResult;

			expect(result.profile).toEqual({ visitor: "v-second" });
			expect(harness.emitted("session:ended")).toHaveLength(0);
		});
	});

	describe("app crash recovery", () => {
		it("re-answers the live Session to a client that reconnects", async () => {
			const harness = await setupSession();
			harness.vendor.tap("wristband-ada");
			await flushTaps();

			const rehydrated = (await harness.execute({
				type: "session.current",
			})) as SessionCurrentResult;

			expect(rehydrated.session).toEqual(harness.state.read().current);
			expect(rehydrated.profile).toEqual({ displayName: "Ada Lovelace", membership: "patron" });
		});

		it("emits session:current on every canon change so a replay stays accurate", async () => {
			const harness = await setupSession();
			harness.vendor.tap("wristband-ada");
			await flushTaps();
			harness.vendor.tap("wristband-ada");
			await flushTaps();
			harness.vendor.tap("wristband-grace");
			await flushTaps();
			await harness.execute({ type: "session.end" });

			expect(harness.emitted("session:current")).toEqual([
				{ session: expect.objectContaining({ visitorId: "v-ada", seq: 1 }) },
				{ session: expect.objectContaining({ visitorId: "v-ada", seq: 2 }) },
				{ session: expect.objectContaining({ visitorId: "v-grace", seq: 3 }) },
				{ session: null },
			]);
		});
	});

	describe("disconnect", () => {
		it("detaches from the vendor", async () => {
			const harness = await setupSession();

			await harness.disconnect();

			expect(harness.vendor.subscriberCount).toBe(0);
		});

		it("stops servicing taps", async () => {
			const harness = await setupSession();
			await harness.disconnect();

			harness.vendor.tap("wristband-ada");
			await flushTaps();

			expect(harness.state.read().current).toBeNull();
		});

		it("goes quiet when a Credential lookup lands after disconnect", async () => {
			const deferred = createDeferredVendor();
			const harness = await setupBroker(deferred.vendor);

			deferred.tap("wristband-1");
			await harness.disconnect();
			const writesAtDisconnect = harness.state.writes();

			deferred.answerCredential(0, "v-ada");
			await flushTaps();

			expect(harness.eventNames()).toEqual([]);
			expect(harness.state.writes()).toBe(writesAtDisconnect);
			expect(harness.state.read()).toEqual({ current: null, degraded: false });
		});

		it("goes quiet when a Profile lookup lands after disconnect", async () => {
			const deferred = createDeferredVendor({ deferProfiles: true });
			const harness = await setupBroker(deferred.vendor);

			deferred.tap("wristband-1");
			deferred.answerCredential(0, "v-ada");
			await flushTaps();
			await harness.disconnect();
			const writesAtDisconnect = harness.state.writes();

			deferred.answerProfile(0);
			await flushTaps();

			expect(harness.eventNames()).toEqual([]);
			expect(harness.state.writes()).toBe(writesAtDisconnect);
			expect(harness.state.read()).toEqual({ current: null, degraded: false });
		});
	});

	describe("a misbehaving adapter", () => {
		it("logs a tap it could not service instead of rejecting unhandled", async () => {
			const handlers = new Set<TapHandler>();
			const vendor: VendorClient = {
				name: "throwing",
				resolveCredential() {
					throw new Error("adapter blew up");
				},
				fetchProfile() {
					return okAsync(sealProfile({ data: {}, language: "en" }));
				},
				subscribeTaps(handler) {
					handlers.add(handler);
					return () => {
						handlers.delete(handler);
					};
				},
			};
			const harness = await setupBroker(vendor);

			for (const handler of handlers) {
				handler({ credential: "wristband-1", observedAt: new Date() });
			}
			await flushTaps();

			expect(harness.ctx.logger.error).toHaveBeenCalledOnce();
			expect(JSON.stringify(harness.ctx.logger.error.mock.calls)).not.toContain("wristband-1");
			expect(harness.state.read().current).toBeNull();
		});
	});
});
