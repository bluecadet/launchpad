import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ContentTransformContext } from "../../content-transform.js";
import type { ArtifactCache as PublicArtifactCache } from "../../index.js";
import type { ArtifactCacheCapability } from "../artifact-cache.js";
import type { HttpDownloadOptions } from "../http-cache.js";

describe("transform-facing artifact capability", () => {
	it("exposes a structural operation contract without lifecycle controls", () => {
		expectTypeOf<ContentTransformContext["cache"]>().toEqualTypeOf<ArtifactCacheCapability>();
		expectTypeOf<PublicArtifactCache>().toEqualTypeOf<ArtifactCacheCapability>();
		expectTypeOf<
			Extract<
				keyof ArtifactCacheCapability,
				"beginPublication" | "commitPublication" | "invalidate" | "abort" | "close" | "lookupRecord"
			>
		>().toEqualTypeOf<never>();
		expectTypeOf<Extract<keyof HttpDownloadOptions, "filePath">>().toEqualTypeOf<never>();

		const capability = {
			available: false,
			derive: vi.fn<ArtifactCacheCapability["derive"]>(async () => ({ reused: false })),
			claimOutputs: vi.fn<ArtifactCacheCapability["claimOutputs"]>(async () => {}),
			claimHttp: vi.fn<ArtifactCacheCapability["claimHttp"]>(async () => "/staged/output"),
			lookupHttp: vi.fn<ArtifactCacheCapability["lookupHttp"]>(async () => undefined),
			reuseHttp: vi.fn<ArtifactCacheCapability["reuseHttp"]>(async () => false),
			storeHttp: vi.fn<ArtifactCacheCapability["storeHttp"]>(async () => {}),
		} satisfies ArtifactCacheCapability;
		expect(capability.available).toBe(false);
	});
});
