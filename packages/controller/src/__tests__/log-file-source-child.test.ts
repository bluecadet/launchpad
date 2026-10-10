import * as fsPromises from "node:fs/promises";
import { normalizeLogRecord } from "@bluecadet/launchpad-utils/logging";
import { afterAll, describe, expect, it, vi } from "vitest";
import { fail, unwrap } from "./log-result-test-utils.js";

vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
}));

import { createLogFileSource, type LogFileSourceOwner } from "../core/log-file-source.js";

const directory = process.env.LAUNCHPAD_LOG_SOURCE_CHILD_DIRECTORY;
const mode = process.env.LAUNCHPAD_LOG_SOURCE_CHILD_MODE;
let owner: LogFileSourceOwner | undefined;

afterAll(async () => {
	if (!owner) return;
	await owner.close(new AbortController().signal).then((result) => unwrap(result), fail);
});

describe.skipIf(!directory || !mode)("log file source child process fixture", () => {
	it("exercises native ownership through the public source factory", async () => {
		if (!directory) throw new Error("Missing child log directory");
		if (mode === "attempt") {
			expect(createLogFileSource({ directory })._unsafeUnwrapErr().message).toMatch(
				/already owned/i,
			);
			process.stdout.write("LAUNCHPAD_CHILD_DENIED\n");
			return;
		}
		if (mode === "retention") {
			owner = createLogFileSource({
				directory,
				maxBytes: 1024,
				maxSegmentBytes: 1024,
				maxAgeMs: 0,
			})._unsafeUnwrap();
			const makeRecord = (message: string) =>
				normalizeLogRecord(
					{ timestamp: new Date(), level: "info", message, event: "log:info", metadata: {} },
					{},
				)._unsafeUnwrap();
			owner.append(makeRecord("old".repeat(200)));
			await owner.source.flush(new AbortController().signal).then((result) => unwrap(result), fail);
			const reader = await owner.source
				.createReader({ checkpointId: "crash-retention" }, new AbortController().signal)
				.then((result) => unwrap(result), fail);
			await reader
				.read({
					maxEntries: 10,
					maxBytes: 1000000,
					signal: new AbortController().signal,
				})
				.then((result) => unwrap(result), fail);
			const remove = fsPromises.rm;
			vi.spyOn(fsPromises, "rm").mockImplementation(async (target, options) => {
				await remove(target, options);
				if (String(target).endsWith(".sealed.jsonl")) {
					process.stdout.write("LAUNCHPAD_CHILD_UNLINKED\n");
					await new Promise<void>(() => undefined);
				}
			});
			owner.append(makeRecord("new".repeat(200)));
			await new Promise<void>(() => undefined);
			return;
		}

		if (mode !== "hold") throw new Error(`Unknown child mode: ${mode}`);
		owner = createLogFileSource({ directory })._unsafeUnwrap();
		process.stdout.write("LAUNCHPAD_CHILD_LOCKED\n");
		await new Promise<void>(() => undefined);
	});
});
