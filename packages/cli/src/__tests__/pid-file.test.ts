import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { getDaemonPid } from "@bluecadet/launchpad-controller/pid-utils";
import { afterEach, describe, expect, it } from "vitest";

describe("getDaemonPid", () => {
	let pidFile: string;

	afterEach(() => {
		try {
			fs.rmSync(pidFile);
		} catch {}
	});

	it("returns null when pid file does not exist", () => {
		pidFile = "/test.pid";

		const result = getDaemonPid(pidFile);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
	});

	it("returns null and removes stale pid file when process is not running", () => {
		pidFile = "/test.pid";

		// spawnSync blocks until the child exits — its PID is guaranteed dead on return.
		const { pid: deadPid } = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
		fs.writeFileSync(pidFile, String(deadPid));

		const result = getDaemonPid(pidFile);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
		expect(fs.existsSync(pidFile)).toBe(false);
	});

	it("returns the pid when process is running", () => {
		pidFile = "/test.pid";
		fs.writeFileSync(pidFile, String(process.pid));

		const result = getDaemonPid(pidFile);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe(process.pid);
	});
});
