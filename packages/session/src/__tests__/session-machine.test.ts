import { beforeEach, describe, expect, it } from "vitest";
import { SessionMachine } from "../broker/session-machine.js";
import { type SessionId, toSessionId, toVisitorId } from "../core/ids.js";

const IDLE_TIMEOUT_MS = 60_000;

/** A clock the test moves by hand — the machine never reads the wall clock. */
function createTestClock(start = 1_000) {
	let current = start;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
}

/** Deterministic Session ids, so assertions can name them. */
function createIdMinter() {
	let count = 0;
	return (): SessionId => {
		count += 1;
		return toSessionId(`session-${count}`);
	};
}

describe("SessionMachine", () => {
	let clock: ReturnType<typeof createTestClock>;
	let machine: SessionMachine;

	beforeEach(() => {
		clock = createTestClock();
		machine = new SessionMachine({
			idleTimeoutMs: IDLE_TIMEOUT_MS,
			now: clock.now,
			mintSessionId: createIdMinter(),
		});
	});

	/** Feeds a tap through ingress ordering, the way the broker does. */
	function tap(credential: string, overrides: { language?: string; degraded?: boolean } = {}) {
		return machine.applyTap({
			tapSeq: machine.nextTapSeq(),
			credential,
			visitorId: toVisitorId(`visitor-for-${credential}`),
			language: overrides.language ?? "en",
			degraded: overrides.degraded ?? false,
		});
	}

	/** Records vendor health for a tap of its own, the way the broker does. */
	function health(healthy: boolean) {
		return machine.recordVendorHealth(healthy, machine.nextTapSeq());
	}

	describe("starting a Session", () => {
		it("starts a Session on the first resolved tap", () => {
			const effects = tap("wristband-1", { language: "es" });

			expect(effects).toEqual([
				{
					type: "started",
					session: {
						sessionId: "session-1",
						visitorId: "visitor-for-wristband-1",
						language: "es",
						degraded: false,
						seq: 1,
					},
				},
				{ type: "current", session: expect.objectContaining({ sessionId: "session-1" }) },
			]);
		});

		it("publishes the started Session as the current canon", () => {
			tap("wristband-1");

			expect(machine.snapshot).toEqual({
				current: expect.objectContaining({ sessionId: "session-1", seq: 1 }),
				degraded: false,
			});
		});

		it("arms the idle deadline from the tap", () => {
			tap("wristband-1");

			expect(machine.expiresAt).toBe(clock.now() + IDLE_TIMEOUT_MS);
		});
	});

	describe("same-Credential re-tap", () => {
		it("refreshes in place rather than ending and restarting", () => {
			tap("wristband-1");
			const effects = tap("wristband-1", { language: "fr" });

			expect(effects).toEqual([
				{
					type: "current",
					session: expect.objectContaining({ sessionId: "session-1", language: "fr", seq: 2 }),
				},
			]);
		});

		it("keeps the same Session id", () => {
			tap("wristband-1");
			tap("wristband-1");

			expect(machine.snapshot.current?.sessionId).toBe("session-1");
		});

		it("pushes the idle deadline out", () => {
			tap("wristband-1");
			clock.advance(30_000);
			tap("wristband-1");

			expect(machine.expiresAt).toBe(clock.now() + IDLE_TIMEOUT_MS);
		});
	});

	describe("replacement by a different Credential", () => {
		it("ends the old Session before starting the new one", () => {
			tap("wristband-1");
			const effects = tap("wristband-2");

			expect(effects.map((effect) => effect.type)).toEqual(["ended", "started", "current"]);
		});

		it("reports the replaced reason on the ended Session", () => {
			tap("wristband-1");
			const [ended] = tap("wristband-2");

			expect(ended).toEqual({
				type: "ended",
				session: expect.objectContaining({ sessionId: "session-1" }),
				reason: "replaced",
			});
		});

		it("arms the idle deadline for the replacement", () => {
			tap("wristband-1");
			clock.advance(10_000);
			tap("wristband-2");

			expect(machine.expiresAt).toBe(clock.now() + IDLE_TIMEOUT_MS);
		});

		it("mints a fresh Session id for the replacement", () => {
			tap("wristband-1");
			tap("wristband-2");

			expect(machine.snapshot.current).toMatchObject({
				sessionId: "session-2",
				visitorId: "visitor-for-wristband-2",
				seq: 2,
			});
		});
	});

	describe("idle timeout", () => {
		it("ends the Session once the deadline passes", () => {
			tap("wristband-1");
			clock.advance(IDLE_TIMEOUT_MS);

			const effects = machine.expireIdle();

			expect(effects).toEqual([
				{
					type: "ended",
					session: expect.objectContaining({ sessionId: "session-1" }),
					reason: "timeout",
				},
				{ type: "current", session: null },
			]);
		});

		it("goes idle after the timeout", () => {
			tap("wristband-1");
			clock.advance(IDLE_TIMEOUT_MS);
			machine.expireIdle();

			expect(machine.snapshot.current).toBeNull();
			expect(machine.expiresAt).toBeNull();
		});

		it("ignores a timer that fires before the refreshed deadline", () => {
			tap("wristband-1");
			clock.advance(IDLE_TIMEOUT_MS - 1);

			expect(machine.expireIdle()).toEqual([]);
			expect(machine.snapshot.current).not.toBeNull();
		});

		it("does nothing when already idle", () => {
			expect(machine.expireIdle()).toEqual([]);
		});
	});

	describe("explicit end", () => {
		it("ends the active Session", () => {
			tap("wristband-1");

			expect(machine.end()).toEqual([
				{
					type: "ended",
					session: expect.objectContaining({ sessionId: "session-1" }),
					reason: "explicit",
				},
				{ type: "current", session: null },
			]);
		});

		it("is a no-op when already idle", () => {
			expect(machine.end()).toEqual([]);
			expect(machine.snapshot.current).toBeNull();
		});

		it("retires a lookup that was already in flight", () => {
			const inFlightSeq = machine.nextTapSeq();
			machine.end();

			const late = machine.applyTap({
				tapSeq: inFlightSeq,
				credential: "wristband-1",
				visitorId: toVisitorId("visitor-1"),
				language: "en",
				degraded: false,
			});

			expect(late).toEqual([]);
			expect(machine.snapshot.current).toBeNull();
		});

		it("retires a lookup in flight behind the Session it ends", () => {
			tap("wristband-1");
			const inFlightSeq = machine.nextTapSeq();
			machine.end();

			machine.applyTap({
				tapSeq: inFlightSeq,
				credential: "wristband-2",
				visitorId: toVisitorId("visitor-2"),
				language: "en",
				degraded: false,
			});

			expect(machine.snapshot.current).toBeNull();
		});

		it("lets the next tap start a brand new Session", () => {
			tap("wristband-1");
			machine.end();
			tap("wristband-1");

			expect(machine.snapshot.current).toMatchObject({ sessionId: "session-2", seq: 2 });
		});
	});

	describe("seq", () => {
		it("increases once per canon change and never repeats", () => {
			const seqs: number[] = [];
			const record = () => seqs.push(machine.snapshot.current?.seq ?? -1);

			tap("wristband-1");
			record();
			tap("wristband-1");
			record();
			tap("wristband-2");
			record();
			machine.end();
			tap("wristband-3");
			record();

			expect(seqs).toEqual([1, 2, 3, 4]);
		});

		it("does not advance for a tap the machine ignored", () => {
			tap("wristband-1");
			machine.applyTap({
				tapSeq: 1,
				credential: "wristband-1",
				visitorId: toVisitorId("visitor-for-wristband-1"),
				language: "en",
				degraded: false,
			});

			expect(machine.snapshot.current?.seq).toBe(1);
		});
	});

	describe("degraded flag", () => {
		it("starts healthy and stays quiet while the vendor answers", () => {
			expect(machine.snapshot.degraded).toBe(false);
			expect(health(true)).toEqual([]);
		});

		it("announces the transition into degraded exactly once", () => {
			const first = health(false);
			const second = health(false);

			expect(first).toEqual([{ type: "degraded", degraded: true }]);
			expect(second).toEqual([]);
			expect(machine.snapshot.degraded).toBe(true);
		});

		it("announces recovery once the vendor answers again", () => {
			health(false);

			expect(health(true)).toEqual([{ type: "degraded", degraded: false }]);
			expect(machine.snapshot.degraded).toBe(false);
		});

		it("leaves the Session canon alone", () => {
			tap("wristband-1");
			health(false);

			expect(machine.snapshot.current).toMatchObject({ degraded: false, seq: 1 });
		});

		it("carries a degraded tap onto the Session it opens", () => {
			health(false);
			tap("wristband-1", { degraded: true });

			expect(machine.snapshot.current).toMatchObject({ degraded: true });
		});

		it("ignores a failure reported by a tap a newer lookup already overtook", () => {
			const staleSeq = machine.nextTapSeq();
			const winningSeq = machine.nextTapSeq();

			machine.recordVendorHealth(true, winningSeq);
			const stale = machine.recordVendorHealth(false, staleSeq);

			expect(stale).toEqual([]);
			expect(machine.snapshot.degraded).toBe(false);
		});

		it("still hears recovery from a tap newer than the failure", () => {
			const failingSeq = machine.nextTapSeq();
			const recoveringSeq = machine.nextTapSeq();

			machine.recordVendorHealth(false, failingSeq);

			expect(machine.recordVendorHealth(true, recoveringSeq)).toEqual([
				{ type: "degraded", degraded: false },
			]);
		});
	});

	describe("concurrent taps", () => {
		it("ignores a resolve that lost the race to a newer tap", () => {
			const staleSeq = machine.nextTapSeq();
			const winningSeq = machine.nextTapSeq();

			machine.applyTap({
				tapSeq: winningSeq,
				credential: "wristband-2",
				visitorId: toVisitorId("visitor-2"),
				language: "en",
				degraded: false,
			});
			const stale = machine.applyTap({
				tapSeq: staleSeq,
				credential: "wristband-1",
				visitorId: toVisitorId("visitor-1"),
				language: "en",
				degraded: false,
			});

			expect(stale).toEqual([]);
			expect(machine.snapshot.current).toMatchObject({ visitorId: "visitor-2" });
		});

		it("does not resurrect a Credential a later tap already replaced", () => {
			tap("wristband-1");
			const slowSeq = machine.nextTapSeq();
			tap("wristband-2");

			machine.applyTap({
				tapSeq: slowSeq,
				credential: "wristband-1",
				visitorId: toVisitorId("visitor-for-wristband-1"),
				language: "en",
				degraded: false,
			});

			expect(machine.snapshot.current).toMatchObject({
				visitorId: "visitor-for-wristband-2",
				seq: 2,
			});
		});

		it("does not let a stale resolve push the idle deadline out", () => {
			const staleSeq = machine.nextTapSeq();
			tap("wristband-2");
			const deadline = machine.expiresAt;

			clock.advance(10_000);
			machine.applyTap({
				tapSeq: staleSeq,
				credential: "wristband-1",
				visitorId: toVisitorId("visitor-1"),
				language: "en",
				degraded: false,
			});

			expect(machine.expiresAt).toBe(deadline);
		});
	});
});
