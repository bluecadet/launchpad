import type { Brand } from "@bluecadet/launchpad-utils/types";

/**
 * The raw, vendor-shaped contents of a Profile. Launchpad never inspects this — its
 * shape belongs entirely to the vendor.
 */
export type ProfileData = Readonly<Record<string, unknown>>;

/**
 * Vendor-owned data about a Visitor, sealed.
 *
 * A Profile is an in-memory passthrough blob: it may be forwarded to the Station app,
 * but it must never enter the state store, a log line, or an event payload. Only
 * `language` — the one field launchpad canonicalizes — is readable directly. Everything
 * else requires an explicit {@link unsealProfile} call, so a passthrough is always a
 * deliberate, greppable act rather than an accidental spread or `JSON.stringify`.
 *
 * The seal is enforced at runtime too: serializing or inspecting a Profile yields
 * {@link PROFILE_REDACTED} instead of its contents.
 */
export type Profile = Brand<ProfileFields, "Profile">;

/** Everything a Profile lets you read without unsealing it. */
type ProfileFields = {
	/**
	 * BCP-47 language tag this Profile declares, if any. Canon: this field is allowed
	 * into Session state and event payloads.
	 */
	readonly language?: string;
	/** Always returns {@link PROFILE_REDACTED}. Use {@link unsealProfile} to forward contents. */
	toJSON(): string;
};

/** Stand-in emitted whenever a Profile is serialized or inspected. */
export const PROFILE_REDACTED = "[Profile redacted]";

/**
 * Payloads live beside the Profile rather than on it, so there is no property — hidden,
 * symbol-keyed, or otherwise — for a spread, a serializer, or a debugger to reach.
 *
 * The trade-off is that a Profile is identified by object identity, not by its contents.
 * Two situations break that identity and make {@link unsealProfile} throw:
 *
 * - **A copy.** Anything that clones or drafts the object — Immer, `structuredClone`, a
 *   spread — produces a value that is no longer the sealed Profile. This should not arise
 *   in the intended flow, because a Profile never enters the state store in the first
 *   place; it is forwarded in memory and dropped.
 * - **A duplicated package.** Two copies of this package in one dependency tree mean two
 *   module instances, each with its own map, so a Profile sealed by one cannot be
 *   unsealed by the other.
 *
 * Both are identity loss rather than corruption, which is why the thrown message names
 * them: the failure otherwise reads like a bug in the seal.
 */
const payloads = new WeakMap<Profile, ProfileData>();

const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

/**
 * Seals vendor Profile contents behind the passthrough boundary. Adapter authors call
 * this at the edge; `language` is lifted out because it is the only field launchpad is
 * allowed to canonicalize.
 */
export function sealProfile(input: { data: ProfileData; language?: string }): Profile {
	const fields: ProfileFields = Object.freeze({
		...(input.language === undefined ? {} : { language: input.language }),
		toJSON: () => PROFILE_REDACTED,
		toString: () => PROFILE_REDACTED,
		[inspectCustom]: () => PROFILE_REDACTED,
	});

	const profile = fields as Profile;
	payloads.set(profile, input.data);
	return profile;
}

/**
 * Opens a sealed Profile for passthrough to the Station app.
 *
 * Calling this puts vendor-owned data in your hands: forward it, never store or log it.
 *
 * Throws when the value is not a Profile this module sealed — either it never came from
 * {@link sealProfile}, or it is a copy of one that lost its identity. See the note on the
 * payload map for the two ways that happens.
 */
export function unsealProfile(profile: Profile): ProfileData {
	const data = payloads.get(profile);
	if (data === undefined) {
		throw new TypeError(
			"Not a sealed Profile. A Profile is matched by object identity, so the usual cause " +
				"is a copy rather than the original: something cloned, drafted, or spread it " +
				"(Immer, structuredClone, JSON round-trip). Forward the object sealProfile() " +
				"returned. Failing that, check for two copies of @bluecadet/launchpad-session in " +
				"the dependency tree — each module instance seals into its own map.",
		);
	}
	return data;
}
