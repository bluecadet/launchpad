/** Derive checkpoint identity without throwing or validating the rest of the config. */
export function normalizeCheckpointEndpoint(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const endpoint = URL.parse(value);
	if (
		!endpoint ||
		(endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		return undefined;
	endpoint.pathname = endpoint.pathname.replace(/\/+$/u, "");
	return endpoint.toString();
}
