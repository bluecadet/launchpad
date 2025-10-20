/**
 * PID file management for persistent mode.
 * Handles writing, reading, and cleaning up PID files for daemon detection.
 */

import fs from "node:fs";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";

/**
 * Ensure the directory for a file path exists
 */
function ensureDirSync(filePath: string): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * Write PID to file
 */
export function writePidFile(pidFile: string, pid: number): Result<void, Error> {
	try {
		ensureDirSync(pidFile);
		fs.writeFileSync(pidFile, pid.toString(), "utf-8");
		return ok(undefined);
	} catch (e) {
		return err(new Error(`Failed to write PID file: ${e}`));
	}
}

/**
 * Read PID from file
 */
export function readPidFile(pidFile: string): Result<number, Error> {
	try {
		if (!fs.existsSync(pidFile)) {
			return err(new Error("PID file does not exist"));
		}
		const pidStr = fs.readFileSync(pidFile, "utf-8").trim();
		const pid = Number.parseInt(pidStr, 10);
		if (Number.isNaN(pid)) {
			return err(new Error(`Invalid PID in file: ${pidStr}`));
		}
		return ok(pid);
	} catch (e) {
		return err(new Error(`Failed to read PID file: ${e}`));
	}
}

/**
 * Delete PID file
 */
export function deletePidFile(pidFile: string): Result<void, Error> {
	try {
		if (fs.existsSync(pidFile)) {
			fs.unlinkSync(pidFile);
		}
		return ok(undefined);
	} catch (e) {
		return err(new Error(`Failed to delete PID file: ${e}`));
	}
}

/**
 * Check if a process is running by PID
 */
export function isProcessRunning(pid: number): boolean {
	try {
		// Sending signal 0 checks if process exists without killing it
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * Check if a daemon is running based on PID file
 */
export function isDaemonRunning(pidFile: string): Result<boolean, Error> {
	return readPidFile(pidFile).match(
		(pid) => ok(isProcessRunning(pid)),
		() => ok(false),
	);
}

/**
 * Get daemon PID if running, null if not running
 * Also cleans up stale PID files (file exists but process is not running)
 */
export function getDaemonPid(pidFile: string): Result<number | null, Error> {
	return readPidFile(pidFile).match(
		(pid) => {
			if (isProcessRunning(pid)) {
				return ok(pid);
			}
			// PID file exists but process is not running - clean up stale PID file
			deletePidFile(pidFile);
			return ok(null);
		},
		() => ok(null),
	);
}
