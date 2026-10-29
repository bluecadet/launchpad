import type { ClientConfig } from "@sanity/client";
import { vi } from "vitest";

vi.mock("@sanity/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@sanity/client")>();
	return {
		...actual,
		createClient: vi.fn((config: ClientConfig) =>
			actual.createClient({
				...config,
				// The Node SDK uses its own undici fetch, which bypasses MSW. Keep the
				// real client pipeline, but route its requests through MSW's transport.
				resolveFetch: () => globalThis.fetch,
			}),
		),
	};
});
