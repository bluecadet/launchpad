import { z } from "zod";
import type { VendorClient } from "./core/vendor-client.js";

/** One minute of quiet at the Station ends the Session. */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/**
 * Duck-type check for the four required {@link VendorClient} members. Adapters are plain
 * objects written project-side, so this is the only place a typo in one becomes a
 * readable setup error instead of a crash on the first tap.
 */
function isVendorClient(value: unknown): value is VendorClient {
	if (typeof value !== "object" || value === null) return false;
	return (
		"name" in value &&
		typeof value.name === "string" &&
		"resolveCredential" in value &&
		typeof value.resolveCredential === "function" &&
		"fetchProfile" in value &&
		typeof value.fetchProfile === "function" &&
		"subscribeTaps" in value &&
		typeof value.subscribeTaps === "function"
	);
}

export const sessionConfigSchema = z.object({
	/**
	 * The vendor adapter this Station's Sessions are built from. Endpoints, credentials,
	 * retries, and polling cadence are the adapter's own business and never appear here.
	 */
	vendor: z.custom<VendorClient>(isVendorClient, {
		message:
			"vendor must satisfy VendorClient: an object with name, resolveCredential, fetchProfile, and subscribeTaps",
	}),
	/** How long a Session survives with no further tap from its Credential. */
	idleTimeoutMs: z
		.number()
		.int()
		.positive()
		.default(DEFAULT_IDLE_TIMEOUT_MS)
		.describe("Milliseconds of quiet before the current Session times out."),
	/** Used when the vendor is unreachable, or its Profile declares no language. */
	fallbackLanguage: z
		.string()
		.min(1)
		.default("en")
		.describe("BCP-47 tag a Session falls back to when the Profile declares none."),
});

export type SessionConfig = z.input<typeof sessionConfigSchema>;
export type ResolvedSessionConfig = z.output<typeof sessionConfigSchema>;
