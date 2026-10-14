import { describe, it } from "vitest";
import { acquireNativeFileLease } from "../native-file-lease.js";

const lockPath = process.env.LAUNCHPAD_NATIVE_LEASE_CHILD_PATH;

describe.skipIf(!lockPath)("native file lease child process fixture", () => {
	it("holds a native lease until the process exits", async () => {
		if (!lockPath) throw new Error("Missing child lock path");
		acquireNativeFileLease(lockPath, {
			unavailable: "Native locking unavailable",
			acquisitionFailed: "Native lock acquisition failed",
			alreadyOwned: "Native lock already owned",
		})._unsafeUnwrap();
		process.stdout.write("LAUNCHPAD_NATIVE_LEASE_LOCKED\n");
		await new Promise<void>(() => undefined);
	});
});
