import * as fsPromises from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expectLoggingDiagnostic } from "@bluecadet/launchpad-testing/test-utils.ts";
import { expect, it, vi } from "vitest";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
}));

import { controllerConfigSchema } from "../controller-config.js";
import { acquireControllerInstanceLease } from "../core/controller-instance-lease.js";
import { createLogFileSource, type LogFileSourceOwner } from "../core/log-file-source.js";
import { LaunchpadController } from "../launchpad-controller.js";

function gate() {
	let resolve = () => {};
	const promise = new Promise<void>((finish) => {
		resolve = finish;
	});
	return { promise, resolve };
}

it.each(["open", "sync"])(
	"retains project ownership after bounded shutdown while physical %s is pending",
	async (operation) => {
		expectLoggingDiagnostic(
			"File-backed logging did not close cleanly: The operation was aborted due to timeout",
		);
		const directory = await mkdtemp(path.join(tmpdir(), "launchpad-close-settle-"));
		const entered = gate();
		const resume = gate();
		const released = gate();
		const open = fsPromises.open;
		const openSpy = vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
			const activeSegment = String(args[0]).endsWith(".active.jsonl");
			if (activeSegment && operation === "open") {
				entered.resolve();
				await resume.promise;
			}
			const handle = await open(...args);
			if (activeSegment && operation === "sync") {
				const sync = handle.sync.bind(handle);
				vi.spyOn(handle, "sync").mockImplementation(async () => {
					entered.resolve();
					await resume.promise;
					await sync();
				});
			}
			return handle;
		});
		const release = vi.fn();
		const config = controllerConfigSchema.parse({
			logging: { overrideConsole: false, text: { enabled: false } },
		});
		let owner: LogFileSourceOwner | undefined;
		const controller = new LaunchpadController(config, directory, "task", {
			createSource: (options) =>
				createLogFileSource(options).map((created) => {
					owner = created;
					return created;
				}),
			closeTimeoutMs: 20,
			acquireInstanceLease(pidFile, baseDirectory) {
				return acquireControllerInstanceLease(pidFile, baseDirectory).map((lease) => ({
					release() {
						release();
						const result = lease.release();
						released.resolve();
						return result;
					},
				}));
			},
		});
		let successor: LaunchpadController | undefined;
		try {
			expect((await controller.start()).isOk()).toBe(true);
			const stopping = controller.stop();
			await entered.promise;
			expect((await stopping).isOk()).toBe(true);
			expect(release).not.toHaveBeenCalled();
			const earlySuccessor = new LaunchpadController(config, directory);
			try {
				expect((await earlySuccessor.start()).isErr()).toBe(true);
			} finally {
				await earlySuccessor.stop();
			}
			resume.resolve();
			await released.promise;
			expect(release).toHaveBeenCalledOnce();
			successor = new LaunchpadController(config, directory);
			expect((await successor.start()).isOk()).toBe(true);
		} finally {
			resume.resolve();
			await controller.stop();
			await owner?.close(new AbortController().signal);
			await released.promise;
			await successor?.stop();
			openSpy.mockRestore();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
