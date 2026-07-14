import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.unmock("node:fs");

const compiledCliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

function expectCommandHelp(result: SpawnSyncReturns<string>, expectedText: string[]): void {
	expect(result.status).toBe(0);
	for (const text of expectedText) {
		expect(result.stdout).toContain(text);
	}
	expect(result.stderr).toBe("");
}

describe("CLI entrypoint", () => {
	it("prints the available commands when invoked without arguments", () => {
		const result = spawnSync(process.execPath, [compiledCliPath], { encoding: "utf8" });

		expectCommandHelp(result, [
			"Commands:",
			"Starts launchpad controller.",
			"Stops launchpad controller gracefully.",
			"Show the status of the launchpad controller.",
		]);
	});

	it("includes configured plugin commands when invoked without a command", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "launchpad-cli-"));
		const configPath = join(tempDirectory, "launchpad.config.mjs");
		writeFileSync(
			configPath,
			`export default {
	plugins: [{
		name: "content-plugin",
		setup() {},
		manifest: {
			cli: [{
				name: "content",
				description: "Fetch fresh content.",
				commands: [{ type: "content.fetch" }]
			}]
		}
	}]
};`,
		);

		try {
			const result = spawnSync(process.execPath, [compiledCliPath, "--config", configPath], {
				encoding: "utf8",
			});

			expectCommandHelp(result, [
				"content",
				"Fetch fresh content.",
				"Starts launchpad controller.",
			]);
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")("prints help when invoked through a symlink", () => {
		const tempDirectory = mkdtempSync(join(tmpdir(), "launchpad-cli-"));
		const linkedCliPath = join(tempDirectory, "launchpad");

		try {
			symlinkSync(compiledCliPath, linkedCliPath);
			const result = spawnSync(process.execPath, [linkedCliPath, "--help"], { encoding: "utf8" });

			expectCommandHelp(result, ["Starts launchpad controller."]);
		} finally {
			rmSync(tempDirectory, { recursive: true, force: true });
		}
	});
});
