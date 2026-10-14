import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acquireNativeFileLease,
	type NativeFileLease,
	type NativeFileLeaseMessages,
} from "../native-file-lease.js";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

const directories: string[] = [];
const leases: NativeFileLease[] = [];
const children: ChildProcess[] = [];
const messages: NativeFileLeaseMessages = {
	unavailable: "Native locking unavailable",
	acquisitionFailed: "Native lock acquisition failed",
	alreadyOwned: "Native lock already owned",
};
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const childFixture = fileURLToPath(new URL("./native-file-lease-child.test.ts", import.meta.url));

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "launchpad-file-lease-"));
	directories.push(directory);
	return directory;
}

function acquire(lockPath: string): NativeFileLease {
	const lease = acquireNativeFileLease(lockPath, messages)._unsafeUnwrap();
	leases.push(lease);
	return lease;
}

function startChild(lockPath: string): ChildProcess {
	const configPath = path.join(path.dirname(lockPath), "child-vitest.config.mjs");
	writeFileSync(configPath, 'export default { test: { environment: "node", pool: "threads" } };');
	// The worker must live inside the child process so SIGKILL also kills the
	// descriptor owner, rather than leaving a separate fork-pool worker alive.
	const child = spawn(
		process.execPath,
		[
			path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs"),
			"run",
			childFixture,
			"--config",
			configPath,
			"--testTimeout",
			"60000",
		],
		{
			cwd: repositoryRoot,
			env: { ...process.env, LAUNCHPAD_NATIVE_LEASE_CHILD_PATH: lockPath },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	children.push(child);
	return child;
}

function waitForOwnership(child: ChildProcess): Promise<void> {
	return new Promise((resolve, reject) => {
		let output = "";
		const cleanup = () => {
			clearTimeout(timeout);
			child.stdout?.off("data", collectOutput);
			child.stderr?.off("data", collectOutput);
			child.off("exit", onExit);
			child.off("error", onError);
		};
		const collectOutput = (chunk: Buffer | string) => {
			output += chunk.toString();
			if (!output.includes("LAUNCHPAD_NATIVE_LEASE_LOCKED")) return;
			cleanup();
			resolve();
		};
		const onExit = () => {
			cleanup();
			reject(new Error(`Child exited before acquiring the lease: ${output}`));
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for native lease: ${output}`));
		}, 15_000);
		child.stdout?.on("data", collectOutput);
		child.stderr?.on("data", collectOutput);
		child.once("exit", onExit);
		child.once("error", onError);
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
	vi.restoreAllMocks();
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await waitForExit(child);
	}
	for (const lease of leases.splice(0)) lease.release();
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("native file leases", () => {
	it("creates parent directories and denies contention without waiting", async () => {
		const directory = await temporaryDirectory();
		const lockPath = path.join(directory, "cache", "project.lock");
		acquire(lockPath);
		expect((await stat(lockPath)).isFile()).toBe(true);
		expect(acquireNativeFileLease(lockPath, messages)._unsafeUnwrapErr().message).toBe(
			messages.alreadyOwned,
		);

		// Unrelated projects are not serialized by a global lock.
		acquire(path.join(directory, "other-project.lock"));
	});

	it("releases idempotently without replacing or removing the permanent lock file", async () => {
		const lockPath = path.join(await temporaryDirectory(), "project.lock");
		await writeFile(lockPath, "permanent lock identity");
		const identity = await stat(lockPath);
		const owner = acquire(lockPath);
		expect(owner.release()?.isOk()).toBe(true);
		expect(owner.release()?.isOk()).toBe(true);
		expect((await stat(lockPath)).ino).toBe(identity.ino);
		expect(await readFile(lockPath, "utf8")).toBe("permanent lock identity");

		const successor = acquire(lockPath);
		// Releasing the old handle again must not unlock the successor.
		expect(owner.release()?.isOk()).toBe(true);
		expect(acquireNativeFileLease(lockPath, messages).isErr()).toBe(true);
		expect(successor.release()?.isOk()).toBe(true);
	});

	it("closes the descriptor even when native unlock fails", async () => {
		const lockPath = path.join(await temporaryDirectory(), "project.lock");
		const owner = acquire(lockPath);
		const nativeFileExtensions = createRequire(import.meta.url)("fs-native-extensions") as {
			unlock(descriptor: number): void;
		};
		const unlock = vi.spyOn(nativeFileExtensions, "unlock").mockImplementation(() => {
			throw new Error("Native unlock failed");
		});
		expect(owner.release()?._unsafeUnwrapErr().message).toBe("Native unlock failed");
		expect(unlock).toHaveBeenCalledOnce();
		unlock.mockRestore();

		// Closing the descriptor must still relinquish kernel ownership.
		acquire(lockPath);
	});

	it("returns filesystem acquisition failures with the caller's message and cause", async () => {
		const directory = await temporaryDirectory();
		const blockedParent = path.join(directory, "not-a-directory");
		await writeFile(blockedParent, "file");
		const error = acquireNativeFileLease(
			path.join(blockedParent, "project.lock"),
			messages,
		)._unsafeUnwrapErr();
		expect(error.message).toBe(messages.acquisitionFailed);
		expect(error.cause).toBeInstanceOf(Error);
	});

	it("denies a cross-process writer and recovers automatically after its owner is killed", async () => {
		const lockPath = path.join(await temporaryDirectory(), "project.lock");
		const child = startChild(lockPath);
		await waitForOwnership(child);
		const identity = await stat(lockPath);
		expect(acquireNativeFileLease(lockPath, messages)._unsafeUnwrapErr().message).toBe(
			messages.alreadyOwned,
		);

		child.kill("SIGKILL");
		await waitForExit(child);
		const recovered = acquire(lockPath);
		expect((await stat(lockPath)).ino).toBe(identity.ino);
		expect(recovered.release()?.isOk()).toBe(true);
	});
});
