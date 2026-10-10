import { closeSync, constants, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import { err, ok, Result } from "neverthrow";

export interface NativeFileLease {
	release(): Result<void, Error> | void;
}

interface NativeFileLeaseMessages {
	readonly unavailable: string;
	readonly acquisitionFailed: string;
	readonly alreadyOwned: string;
}

type NativeFileExtensions = typeof import("fs-native-extensions").default;
const require = createRequire(import.meta.url);

function loadNativeFileExtensions(): NativeFileExtensions {
	return require("fs-native-extensions") as NativeFileExtensions;
}

function closeDescriptor(descriptor: number): Result<void, Error> {
	return Result.fromThrowable(() => closeSync(descriptor), ensureError)();
}

function createLease(
	descriptor: number,
	nativeFileExtensions: NativeFileExtensions,
): NativeFileLease {
	let released = false;
	return {
		release(): Result<void, Error> {
			if (released) return ok(undefined);
			released = true;
			const unlock = Result.fromThrowable(
				() => nativeFileExtensions.unlock(descriptor),
				ensureError,
			)();
			// Always close, including when the native unlock fails.
			const close = closeDescriptor(descriptor);
			return unlock.isErr() ? err(unlock.error) : close;
		},
	};
}

function lockDescriptor(
	descriptor: number,
	messages: NativeFileLeaseMessages,
): Result<NativeFileLease, Error> {
	return Result.fromThrowable(
		loadNativeFileExtensions,
		(error) => new Error(messages.unavailable, { cause: error }),
	)().andThen((nativeFileExtensions) =>
		Result.fromThrowable(
			() => nativeFileExtensions.tryLock(descriptor),
			(error) => new Error(messages.acquisitionFailed, { cause: error }),
		)().andThen((granted) =>
			granted
				? ok(createLease(descriptor, nativeFileExtensions))
				: err(new Error(messages.alreadyOwned)),
		),
	);
}

/**
 * Acquire an exclusive operating-system lease for a permanent lock file.
 *
 * The file must never be deleted or replaced: doing so creates a second file
 * identity that another process could lock while this lease remains active.
 * Filesystem, native-binding, and contention failures are returned as Results.
 */
export function acquireNativeFileLease(
	lockPath: string,
	messages: NativeFileLeaseMessages,
): Result<NativeFileLease, Error> {
	return Result.fromThrowable(
		() => {
			mkdirSync(path.dirname(lockPath), { recursive: true });
			return openSync(lockPath, constants.O_CREAT | constants.O_RDWR, 0o600);
		},
		(error) => new Error(messages.acquisitionFailed, { cause: error }),
	)().andThen((descriptor) => {
		const acquisition = lockDescriptor(descriptor, messages);
		if (acquisition.isErr()) closeDescriptor(descriptor);
		return acquisition;
	});
}
