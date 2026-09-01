export type { SessionId, VisitorId } from "./core/ids.js";
export { newSessionId, toSessionId, toVisitorId } from "./core/ids.js";
export type { Profile, ProfileData } from "./core/profile.js";
export { PROFILE_REDACTED, sealProfile, unsealProfile } from "./core/profile.js";
export type { Session } from "./core/session.js";
export type {
	CredentialTap,
	TapHandler,
	Unsubscribe,
	VendorCallOptions,
	VendorClient,
} from "./core/vendor-client.js";
export type {
	FakeVendor,
	FakeVendorCall,
	FakeVendorConfig,
	FakeVendorFault,
	ResolvedFakeVendorConfig,
} from "./vendors/fake.js";
export { fakeVendor, fakeVendorConfigSchema } from "./vendors/fake.js";
