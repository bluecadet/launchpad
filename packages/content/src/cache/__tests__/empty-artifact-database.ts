import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactCache } from "../artifact-cache.js";

/** Reuse schema initialization, never a writable database or live WAL. */
export async function createEmptyArtifactDatabase() {
	const directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-empty-artifact-db-"));
	const databasePath = path.join(directory, "artifacts.sqlite");
	try {
		const cache = await createArtifactCache({
			databasePath,
			previousRoot: () => undefined,
			stagedRoot: () => directory,
		});
		try {
			if (!cache.available) throw new Error("Could not initialize the empty artifact database");
		} finally {
			// Closing the only connection checkpoints the empty WAL before any copies.
			await cache.close();
		}
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}

	return {
		async copyTo(destination: string) {
			await mkdir(path.dirname(destination), { recursive: true });
			// Never replace an existing database, including one opened by another run.
			await copyFile(databasePath, destination, constants.COPYFILE_EXCL);
		},
		async close() {
			await rm(directory, { recursive: true, force: true });
		},
	};
}
