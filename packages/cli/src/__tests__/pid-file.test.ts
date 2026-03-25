// These vi.unmock calls are hoisted by Vitest before any imports.
// They override the global memfs mocks from setup.ts so integration tests
// use the real filesystem.
vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
		pidFile = path.join(os.tmpdir(), `lp-test-${process.pid}-${Date.now()}.pid`);

		const result = getDaemonPid(pidFile);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
	});

	it("returns null and removes stale pid file when process is not running", () => {
		pidFile = path.join(os.tmpdir(), `lp-test-${process.pid}-${Date.now()}.pid`);

		// spawnSync blocks until the child exits — its PID is guaranteed dead on return.
		const { pid: deadPid } = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
		fs.writeFileSync(pidFile, String(deadPid));

		const result = getDaemonPid(pidFile);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
		expect(fs.existsSync(pidFile)).toBe(false);
	});

	it("returns the pid when process is running", () => {
		pidFile = path.join(os.tmpdir(), `lp-test-${process.pid}-${Date.now()}.pid`);
		fs.writeFileSync(pidFile, String(process.pid));

		const result = getDaemonPid(pidFile);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe(process.pid);
	});
});
