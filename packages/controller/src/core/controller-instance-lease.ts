import path from "node:path";
import { acquireNativeFileLease, type NativeFileLease } from "./native-file-lease.js";

export type ControllerInstanceLease = NativeFileLease;

export function controllerInstanceLockPath(pidFile: string): string {
	return `${pidFile}.lock`;
}

/**
 * Reserve the configured controller identity for one task or persistent
 * controller. The adjacent PID file remains persistent-daemon discovery
 * metadata; this kernel-backed lease is the ownership authority.
 */
export function acquireControllerInstanceLease(
	pidFile: string,
	baseDirectory: string,
): ControllerInstanceLease {
	const lockPath = controllerInstanceLockPath(pidFile);
	return acquireNativeFileLease(lockPath, {
		unavailable: "Native controller instance locking is unavailable",
		acquisitionFailed: "Could not acquire the native controller instance lock",
		alreadyOwned: `Another controller is already active for ${path.resolve(baseDirectory)}`,
	});
}
