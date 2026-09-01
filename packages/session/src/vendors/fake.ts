import { ensureError } from "@bluecadet/launchpad-utils/errors";
import { okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { toVisitorId, type VisitorId } from "../core/ids.js";
import { type Profile, sealProfile } from "../core/profile.js";
import type {
	CredentialTap,
	TapHandler,
	Unsubscribe,
	VendorCallOptions,
	VendorClient,
} from "../core/vendor-client.js";

// ─── Config Schema ─────────────────────────────────────────────────────────

const fakeVisitorSchema = z.object({
	/** Visitor this Credential resolves to. */
	visitorId: z.string(),
	/** BCP-47 language tag this Visitor's Profile declares. Omit to leave it undeclared. */
	language: z.string().optional(),
	/** Vendor-shaped Profile contents handed back by `fetchProfile`. */
	profile: z.record(z.string(), z.unknown()).default({}),
});

const fakeFaultSchema = z.object({
	/** Which call fails. */
	call: z.enum(["resolveCredential", "fetchProfile"]),
	/** Message the call fails with. */
	message: z.string().default("fake vendor is unreachable"),
	/**
	 * Fail this many calls, then recover unprompted. Omit to fail every call until
	 * `clearFaults()`.
	 */
	times: z.number().int().positive().optional(),
});

export const fakeVendorConfigSchema = z.object({
	name: z.string().default("fake").describe("Name reported as VendorClient.name."),
	/**
	 * Listed Credentials resolve to exactly these Visitors and Profiles — use the
	 * directory whenever a test asserts concrete values.
	 */
	visitors: z
		.record(z.string(), fakeVisitorSchema)
		.default({})
		.describe("Credential directory, keyed by Credential."),
	/**
	 * `"derive"` invents a stable Visitor and Profile from the Credential string, so a
	 * demo works with no directory at all. `"unresolved"` answers `ok(null)` — the
	 * vendor's "I do not know this Credential".
	 */
	unlistedCredentials: z
		.enum(["derive", "unresolved"])
		.default("derive")
		.describe("What an unlisted Credential does."),
	/**
	 * The same seed and Credential always produce the same Visitor and Profile, across
	 * runs and machines.
	 */
	seed: z.number().int().default(0).describe("Seeds derived Visitors and Profiles."),
	languages: z
		.array(z.string())
		.nonempty()
		.default(["en", "es", "fr", "de", "ja"])
		.describe("Language pool derived Profiles draw from."),
	/** Honors `options.signal`: an aborted call settles immediately rather than waiting. */
	latencyMs: z
		.object({
			resolveCredential: z.number().nonnegative().default(0),
			fetchProfile: z.number().nonnegative().default(0),
		})
		.default({ resolveCredential: 0, fetchProfile: 0 })
		.describe("Simulated round-trip time per call, in milliseconds."),
	faults: z
		.array(fakeFaultSchema)
		.default([])
		.describe("Faults active from the moment the vendor is created."),
});

export type FakeVendorConfig = z.input<typeof fakeVendorConfigSchema>;
export type ResolvedFakeVendorConfig = z.output<typeof fakeVendorConfigSchema>;

/** A call the fake should fail. */
export type FakeVendorFault = z.input<typeof fakeFaultSchema>;

/** One recorded call, for assertions. */
export type FakeVendorCall =
	| { readonly call: "resolveCredential"; readonly credential: string }
	| { readonly call: "fetchProfile"; readonly visitorId: VisitorId };

/**
 * A {@link VendorClient} with a scripting surface bolted on. The same object goes to the
 * session broker and to the test or demo driving it.
 */
export type FakeVendor = VendorClient & {
	/** Delivers one Credential tap to every subscriber, synchronously. */
	tap(credential: string, options?: { observedAt?: Date }): CredentialTap;
	/**
	 * Delivers a scripted run of taps. At the default `intervalMs` of 0 every tap lands
	 * synchronously, which is what a test wants; give it an interval to pace a demo.
	 */
	tapSequence(credentials: readonly string[], options?: { intervalMs?: number }): Promise<void>;
	/** Starts failing a call. Replaces any fault already active for that call. */
	injectFault(fault: FakeVendorFault): void;
	/** Stops all injected failures — the recovery half of a degraded-mode scenario. */
	clearFaults(): void;
	/** Every call made so far, oldest first. */
	readonly calls: readonly FakeVendorCall[];
	/** How many tap handlers are currently subscribed. */
	readonly subscriberCount: number;
};

type FakeVisitor = z.output<typeof fakeVisitorSchema>;

// ─── Deterministic derivation ───────────────────────────────────────────────

/** FNV-1a. Small, dependency-free, and stable across runs — which is all determinism needs. */
function hash(input: string): number {
	let value = 0x811c9dc5;
	for (let index = 0; index < input.length; index++) {
		value ^= input.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}
	return value;
}

function deriveVisitorId(credential: string, config: ResolvedFakeVendorConfig): string {
	return `visitor-${hash(`${config.seed}:${credential}`).toString(16).padStart(8, "0")}`;
}

/**
 * Derived Profiles hang off the Visitor rather than the Credential, so `fetchProfile`
 * gives the same answer whether or not this instance happens to have resolved the
 * Credential first.
 */
function deriveProfile(visitorId: string, config: ResolvedFakeVendorConfig): FakeVisitor {
	const digest = hash(`${config.seed}:profile:${visitorId}`);
	const token = digest.toString(16).padStart(8, "0");
	const language = config.languages[digest % config.languages.length] ?? config.languages[0];

	return {
		visitorId,
		language,
		profile: {
			displayName: `Visitor ${token.slice(0, 4).toUpperCase()}`,
			language,
			visitCount: (digest % 9) + 1,
		},
	};
}

// ─── Latency and cancellation ───────────────────────────────────────────────

function abortError(signal: AbortSignal): Error {
	return ensureError(signal.reason ?? "fake vendor call aborted");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortError(signal));
	if (ms <= 0) return Promise.resolve();
	if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));

	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout>;
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError(signal));
		};
		timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

// ─── Fault ledger ───────────────────────────────────────────────────────────

type FaultTarget = z.output<typeof fakeFaultSchema>["call"];
type ActiveFault = { message: string; remaining: number | null };

function createFaultLedger(initial: readonly z.output<typeof fakeFaultSchema>[]) {
	const active = new Map<FaultTarget, ActiveFault>();

	function add(fault: z.output<typeof fakeFaultSchema>): void {
		active.set(fault.call, { message: fault.message, remaining: fault.times ?? null });
	}

	for (const fault of initial) add(fault);

	return {
		add,
		clear: () => active.clear(),
		/** Returns the error this call should fail with, consuming one use of the fault. */
		consume(call: FaultTarget): Error | null {
			const fault = active.get(call);
			if (!fault) return null;
			if (fault.remaining !== null) {
				fault.remaining -= 1;
				if (fault.remaining <= 0) active.delete(call);
			}
			return new Error(fault.message);
		},
	};
}

// ─── Vendor factory ─────────────────────────────────────────────────────────

/**
 * Creates an in-memory vendor: scriptable Credential taps, a deterministic Visitor
 * directory, injectable latency, and injectable failures. No network, no hardware.
 *
 * It is the CI backbone and the demo backbone both — a Station app can be driven end to
 * end with nothing but `fakeVendor()` and a few `tap()` calls.
 *
 * @example
 * ```ts
 * const vendor = fakeVendor({
 *   visitors: { "wristband-1": { visitorId: "v-1", language: "es" } },
 * });
 *
 * vendor.subscribeTaps((tap) => console.log(tap.credential));
 * vendor.tap("wristband-1");
 *
 * vendor.injectFault({ call: "fetchProfile", times: 1 }); // one degraded Session
 * vendor.clearFaults();                                   // then recovery
 * ```
 */
export function fakeVendor(config: FakeVendorConfig = {}): FakeVendor {
	const resolved = fakeVendorConfigSchema.parse(config);
	const faults = createFaultLedger(resolved.faults);
	const handlers = new Set<TapHandler>();
	const calls: FakeVendorCall[] = [];

	const listedByVisitor = new Map<string, FakeVisitor>(
		Object.values(resolved.visitors).map((entry) => [entry.visitorId, entry]),
	);

	function resolveToVisitorId(credential: string): string | null {
		const listed = resolved.visitors[credential];
		if (listed) return listed.visitorId;
		if (resolved.unlistedCredentials === "unresolved") return null;
		return deriveVisitorId(credential, resolved);
	}

	function profileFor(visitorId: VisitorId): Profile {
		// An unlisted Visitor still gets a stable answer — model lookup failures with a
		// fault rather than by withholding a Visitor from the directory.
		const entry = listedByVisitor.get(visitorId) ?? deriveProfile(visitorId, resolved);
		return sealProfile({ data: entry.profile, language: entry.language });
	}

	function runCall<T>(
		target: FaultTarget,
		latencyMs: number,
		options: VendorCallOptions | undefined,
		produce: () => T,
	): ResultAsync<T, Error> {
		return ResultAsync.fromPromise(
			delay(latencyMs, options?.signal).then(() => {
				const fault = faults.consume(target);
				if (fault) throw fault;
				return produce();
			}),
			ensureError,
		);
	}

	function deliverTap(credential: string, observedAt?: Date): CredentialTap {
		const tap: CredentialTap = { credential, observedAt: observedAt ?? new Date() };
		for (const handler of [...handlers]) handler(tap);
		return tap;
	}

	return {
		name: resolved.name,

		resolveCredential(
			credential: string,
			options?: VendorCallOptions,
		): ResultAsync<VisitorId | null, Error> {
			calls.push({ call: "resolveCredential", credential });

			return runCall("resolveCredential", resolved.latencyMs.resolveCredential, options, () => {
				const visitorId = resolveToVisitorId(credential);
				return visitorId === null ? null : toVisitorId(visitorId);
			});
		},

		fetchProfile(visitorId: VisitorId, options?: VendorCallOptions): ResultAsync<Profile, Error> {
			calls.push({ call: "fetchProfile", visitorId });

			return runCall("fetchProfile", resolved.latencyMs.fetchProfile, options, () =>
				profileFor(visitorId),
			);
		},

		subscribeTaps(handler: TapHandler): Unsubscribe {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},

		disconnect(): ResultAsync<void, Error> {
			handlers.clear();
			return okAsync(undefined);
		},

		tap(credential: string, options?: { observedAt?: Date }): CredentialTap {
			return deliverTap(credential, options?.observedAt);
		},

		async tapSequence(
			credentials: readonly string[],
			options?: { intervalMs?: number },
		): Promise<void> {
			const intervalMs = options?.intervalMs ?? 0;
			for (const [index, credential] of credentials.entries()) {
				if (index > 0) await delay(intervalMs);
				deliverTap(credential);
			}
		},

		injectFault(fault: FakeVendorFault): void {
			faults.add(fakeFaultSchema.parse(fault));
		},

		clearFaults(): void {
			faults.clear();
		},

		get calls(): readonly FakeVendorCall[] {
			return calls;
		},

		get subscriberCount(): number {
			return handlers.size;
		},
	};
}

export type { VendorClient };
