import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.unmock("node:fs");

const compiledCliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

describe("CLI entrypoint", () => {
	it.skipIf(process.platform === "win32")("prints help when invoked through a symlink", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "launchpad-cli-"));
		const linkedCliPath = join(tempDirectory, "launchpad");

		try {
			symlinkSync(compiledCliPath, linkedCliPath);
			const result = spawnSync(process.execPath, [linkedCliPath, "--help"], { encoding: "utf8" });

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("Starts launchpad controller.");
			expect(result.stderr).toBe("");
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true });
		}
	});
});
