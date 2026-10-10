import path from "node:path";
import { acquireNativeFileLease, type NativeFileLease } from "./native-file-lease.js";

export type LogDirectoryLock = NativeFileLease;

/**
 * Acquire the process-wide log-directory lease. The lock file is deliberately
 * permanent: unlinking or replacing it while locked would create two lock
 * identities and permit split ownership.
 */
export function acquireLogDirectoryLock(directory: string): LogDirectoryLock {
	return acquireNativeFileLease(path.join(directory, ".launchpad-log.lock"), {
		unavailable: "Native log-directory locking is unavailable",
		acquisitionFailed: "Could not acquire the native log-directory lock",
		alreadyOwned: `Log directory is already owned: ${directory}`,
	});
}
