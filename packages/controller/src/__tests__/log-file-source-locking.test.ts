import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

import { createLogFileSource } from "../core/log-file-source.js";

const directories: string[] = [];
const children: ChildProcess[] = [];
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const childFixture = fileURLToPath(new URL("./log-file-source-child.test.ts", import.meta.url));
const vitestEntrypoint = path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "launchpad-native-lock-"));
	directories.push(directory);
	return directory;
}

function startChild(directory: string, mode: "attempt" | "hold" | "retention"): ChildProcess {
	// Keep the lock-owning worker in the spawned process: killing a fork-pool
	// runner alone does not establish that its separate worker has exited.
	const configPath = path.join(directory, "child-vitest.config.mjs");
	writeFileSync(configPath, 'export default { test: { environment: "node", pool: "threads" } };');
	const child = spawn(
		process.execPath,
		[
			vitestEntrypoint,
			"run",
			"--pool",
			"threads",
			childFixture,
			"--config",
			configPath,
			"--testTimeout",
			"60000",
		],
		{
			cwd: repositoryRoot,
			env: {
				...process.env,
				LAUNCHPAD_LOG_SOURCE_CHILD_DIRECTORY: directory,
				LAUNCHPAD_LOG_SOURCE_CHILD_MODE: mode,
			},
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		},
	);
	children.push(child);
	return child;
}

function waitForMessage(child: ChildProcess, expectedType: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let output = "";
		let settled = false;
		const collectOutput = (chunk: Buffer | string) => {
			output += chunk.toString();
			if (output.includes(expectedType)) settle(resolve);
		};
		child.stdout?.on("data", collectOutput);
		child.stderr?.on("data", collectOutput);
		const timeout = setTimeout(() => {
			settle(() =>
				reject(new Error(`Timed out waiting for ${expectedType}. Child output: ${output}`)),
			);
		}, 15_000);
		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			child.off("exit", onExit);
			child.off("message", onMessage);
			child.stdout?.off("data", collectOutput);
			child.stderr?.off("data", collectOutput);
			callback();
		};
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			settle(() =>
				reject(new Error(`Child exited before ${expectedType}: ${code ?? signal}. ${output}`)),
			);
		};
		const onMessage = (message: unknown) => {
			if (
				message !== null &&
				typeof message === "object" &&
				"type" in message &&
				message.type === expectedType
			) {
				settle(resolve);
			}
		};
		child.on("exit", onExit);
		child.on("message", onMessage);
	});
}

function waitForExit(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Timed out waiting for child exit")), 15_000);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
	});
}

afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await waitForExit(child);
	}
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("log file source native ownership", () => {
	it("denies a second child-process owner", async () => {
		const directory = await temporaryDirectory();
		const owner = createLogFileSource({ directory });
		const child = startChild(directory, "attempt");
		await waitForMessage(child, "LAUNCHPAD_CHILD_DENIED");
		await waitForExit(child);
		await owner.close(new AbortController().signal);
	});

	it("releases ownership in the kernel when a child process crashes", async () => {
		const directory = await temporaryDirectory();
		const child = startChild(directory, "hold");
		await waitForMessage(child, "LAUNCHPAD_CHILD_LOCKED");
		expect(() => createLogFileSource({ directory })).toThrow(/already owned/i);

		child.kill("SIGKILL");
		await waitForExit(child);
		const recovered = createLogFileSource({ directory });
		await recovered.close(new AbortController().signal);
	});
	it("reports loss after a crash immediately following retention unlink of never-acked history", async () => {
		const directory = await temporaryDirectory();
		const child = startChild(directory, "retention");
		await waitForMessage(child, "LAUNCHPAD_CHILD_UNLINKED");
		child.kill("SIGKILL");
		await waitForExit(child);
		const owner = createLogFileSource({ directory });
		const reader = await owner.source.createReader(
			{ checkpointId: "crash-retention" },
			new AbortController().signal,
		);
		const batch = await reader.read({
			maxEntries: 10,
			maxBytes: 1000000,
			signal: new AbortController().signal,
		});
		expect(batch.gaps).toContainEqual(
			expect.objectContaining({ reason: "retention", lostRecords: null }),
		);
		await reader.ack(batch.receipt, new AbortController().signal);
		await owner.close(new AbortController().signal);
	});
});
