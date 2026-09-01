import os from "node:os";
import type { NodeIdentity } from "@bluecadet/launchpad-utils/types";
import type { ConfiguredNodeIdentity } from "../controller-config.js";

/** Used when a hostname sanitizes down to nothing. */
const FALLBACK_NODE_ID = "launchpad-node";

/**
 * Derive a Node id from a hostname.
 *
 * Only the segment before the first `.` is used: macOS/Bonjour flips the suffix
 * between `.local` and `.lan` depending on the network, which would otherwise
 * make the id change as a Node moves between networks.
 */
export function deriveNodeIdFromHostname(hostname: string): string {
	const shortHost = hostname.toLowerCase().split(".")[0] ?? "";
	const sanitized = shortHost.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized.length > 0 ? sanitized : FALLBACK_NODE_ID;
}

/**
 * Resolve the configured Node identity into its complete form: `id` falls back
 * to the sanitized short hostname, `label` falls back to `id`, and `role` is
 * left absent when unconfigured.
 */
export function resolveNodeIdentity(
	configured: ConfiguredNodeIdentity,
	hostname: string = os.hostname(),
): NodeIdentity {
	const id = configured.id ?? deriveNodeIdFromHostname(hostname);
	return {
		id,
		label: configured.label ?? id,
		...(configured.role !== undefined && { role: configured.role }),
	};
}
