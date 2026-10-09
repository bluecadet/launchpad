import { closeSync, constants, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface LogDirectoryLock {
	release(): void;
}

const require = createRequire(import.meta.url);

function loadNativeFileExtensions(): typeof import("fs-native-extensions").default {
	return require("fs-native-extensions") as typeof import("fs-native-extensions").default;
}

/**
 * Acquire the process-wide log-directory lease. The lock file is deliberately
 * permanent: unlinking or replacing it while locked would create two lock
 * identities and permit split ownership.
 */
export function acquireLogDirectoryLock(directory: string): LogDirectoryLock {
	mkdirSync(directory, { recursive: true });
	const lockPath = path.join(directory, ".launchpad-log.lock");
	const descriptor = openSync(lockPath, constants.O_CREAT | constants.O_RDWR, 0o600);
	let nativeFileExtensions: typeof import("fs-native-extensions").default;
	try {
		nativeFileExtensions = loadNativeFileExtensions();
	} catch (error) {
		closeSync(descriptor);
		throw new Error("Native log-directory locking is unavailable", { cause: error });
	}

	let granted: boolean;
	try {
		granted = nativeFileExtensions.tryLock(descriptor);
	} catch (error) {
		closeSync(descriptor);
		throw new Error("Could not acquire the native log-directory lock", { cause: error });
	}
	if (!granted) {
		closeSync(descriptor);
		throw new Error(`Log directory is already owned: ${directory}`);
	}

	let released = false;
	return {
		release(): void {
			if (released) return;
			released = true;
			try {
				nativeFileExtensions.unlock(descriptor);
			} finally {
				closeSync(descriptor);
			}
		},
	};
}
