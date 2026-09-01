import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { PROFILE_REDACTED, type Profile, sealProfile, unsealProfile } from "../core/profile.js";

const CONTENTS = { displayName: "Ada Lovelace", membership: "patron", visitCount: 7 };

describe("Profile", () => {
	describe("canon surface", () => {
		it("exposes the declared language", () => {
			const profile = sealProfile({ data: CONTENTS, language: "es" });
			expect(profile.language).toBe("es");
		});

		it("leaves language undefined when the vendor declares none", () => {
			const profile = sealProfile({ data: CONTENTS });
			expect(profile.language).toBeUndefined();
		});

		it("exposes nothing else", () => {
			const profile = sealProfile({ data: CONTENTS, language: "es" });
			expect(Object.keys(profile)).toEqual(["language", "toJSON", "toString"]);
		});
	});

	describe("passthrough seal", () => {
		it("returns the vendor contents when explicitly unsealed", () => {
			const profile = sealProfile({ data: CONTENTS });
			expect(unsealProfile(profile)).toEqual(CONTENTS);
		});

		it("throws when handed something that was never sealed", () => {
			const forged = { language: "en", toJSON: () => "" } as unknown as Profile;
			expect(() => unsealProfile(forged)).toThrow(TypeError);
		});

		it("names identity loss in the error, since a copy is the likely cause", () => {
			const copy = { ...sealProfile({ data: CONTENTS }) } as Profile;
			expect(() => unsealProfile(copy)).toThrow(/object identity/);
		});
	});

	describe("redaction", () => {
		it("redacts under JSON.stringify", () => {
			const profile = sealProfile({ data: CONTENTS, language: "es" });
			expect(JSON.stringify(profile)).toBe(`"${PROFILE_REDACTED}"`);
		});

		it("redacts when nested inside a serialized payload", () => {
			const payload = { sessionId: "s-1", profile: sealProfile({ data: CONTENTS }) };
			expect(JSON.stringify(payload)).not.toContain("Ada Lovelace");
		});

		it("redacts under util.inspect, which is what log formatters reach for", () => {
			const profile = sealProfile({ data: CONTENTS });
			expect(inspect(profile)).toBe(PROFILE_REDACTED);
		});

		it("redacts under string interpolation", () => {
			const profile = sealProfile({ data: CONTENTS });
			expect(`${profile}`).toBe(PROFILE_REDACTED);
		});

		it("holds the contents on no property at all, symbol keys included", () => {
			const profile = sealProfile({ data: CONTENTS, language: "es" });
			const reachable = Reflect.ownKeys(profile).map((key) => Reflect.get(profile, key));

			expect(reachable).not.toContain(CONTENTS);
			expect({ ...profile }).not.toHaveProperty("displayName");
		});
	});
});
