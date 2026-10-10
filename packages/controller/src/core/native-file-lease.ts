import { closeSync, constants, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface NativeFileLease {
	release(): void;
}

interface NativeFileLeaseMessages {
	readonly unavailable: string;
	readonly acquisitionFailed: string;
	readonly alreadyOwned: string;
}

const require = createRequire(import.meta.url);

function loadNativeFileExtensions(): typeof import("fs-native-extensions").default {
	return require("fs-native-extensions") as typeof import("fs-native-extensions").default;
}

/**
 * Acquire an exclusive operating-system lease for a permanent lock file.
 *
 * The file must never be deleted or replaced: doing so creates a second file
 * identity that another process could lock while this lease remains active.
 */
export function acquireNativeFileLease(
	lockPath: string,
	messages: NativeFileLeaseMessages,
): NativeFileLease {
	mkdirSync(path.dirname(lockPath), { recursive: true });
	const descriptor = openSync(lockPath, constants.O_CREAT | constants.O_RDWR, 0o600);
	let nativeFileExtensions: typeof import("fs-native-extensions").default;
	try {
		nativeFileExtensions = loadNativeFileExtensions();
	} catch (error) {
		closeSync(descriptor);
		throw new Error(messages.unavailable, { cause: error });
	}

	let granted: boolean;
	try {
		granted = nativeFileExtensions.tryLock(descriptor);
	} catch (error) {
		closeSync(descriptor);
		throw new Error(messages.acquisitionFailed, { cause: error });
	}
	if (!granted) {
		closeSync(descriptor);
		throw new Error(messages.alreadyOwned);
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
