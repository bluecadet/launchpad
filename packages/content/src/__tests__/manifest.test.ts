import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MANIFEST_FILENAME,
	type Manifest,
	ManifestError,
	mintVersionId,
	readManifest,
	writeManifest,
} from "../manifest.js";

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
	return {
		schemaVersion: 1,
		versionId: "20260714T153045Z",
		versionPath: "versions/20260714T153045Z",
		generatedAt: "2026-07-14T15:30:47.112Z",
		sources: [{ sourceId: "exhibits", path: "exhibits" }],
		...overrides,
	};
}

function errnoException(code: string): NodeJS.ErrnoException {
	const error = new Error(code) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

describe("writeManifest", () => {
	beforeEach(() => {
		vol.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("writes a manifest that the reader sees in full", async () => {
		const manifest = makeManifest();
		const result = await writeManifest("/downloads", manifest);

		expect(result).toBeOk();
		const read = await readManifest("/downloads");
		expect(read).toEqual({ status: "ok", manifest });
	});

	it("leaves no temp file behind after a successful write", async () => {
		const result = await writeManifest("/downloads", makeManifest());

		expect(result).toBeOk();
		expect(vol.readdirSync("/downloads")).toEqual([MANIFEST_FILENAME]);
	});

	it("readers see fully-old or fully-new content across a swap, never torn", async () => {
		const v1 = makeManifest({ versionId: "20260714T153045Z" });
		const v2 = makeManifest({
			versionId: "20260714T163045Z",
			versionPath: "versions/20260714T163045Z",
		});

		await writeManifest("/downloads", v1);
		expect(await readManifest("/downloads")).toEqual({ status: "ok", manifest: v1 });

		await writeManifest("/downloads", v2);
		expect(await readManifest("/downloads")).toEqual({ status: "ok", manifest: v2 });
	});

	it("retries the rename on a transient Windows sharing violation and succeeds", async () => {
		const originalRename = vol.promises.rename.bind(vol.promises);
		const renameSpy = vi
			.spyOn(vol.promises, "rename")
			.mockImplementationOnce(async () => {
				throw errnoException("EBUSY");
			})
			.mockImplementation(async (oldPath, newPath) => originalRename(oldPath, newPath));

		const manifest = makeManifest();
		const result = await writeManifest("/downloads", manifest, {
			retryAttempts: 3,
			retryDelayMs: 1,
		});

		expect(result).toBeOk();
		expect(renameSpy).toHaveBeenCalledTimes(2);
		expect(await readManifest("/downloads")).toEqual({ status: "ok", manifest });
	});

	it("cleans up the temp file once rename retries are exhausted", async () => {
		vi.spyOn(vol.promises, "rename").mockImplementation(async () => {
			throw errnoException("EBUSY");
		});

		const result = await writeManifest("/downloads", makeManifest(), {
			retryAttempts: 2,
			retryDelayMs: 1,
		});

		expect(result).toBeErr();
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(ManifestError);
		expect(vol.existsSync("/downloads")).toBe(true);
		expect(vol.readdirSync("/downloads")).toEqual([]);
	});

	it("does not retry a non-transient rename error", async () => {
		const renameSpy = vi.spyOn(vol.promises, "rename").mockImplementation(async () => {
			throw errnoException("ENOSPC");
		});

		const result = await writeManifest("/downloads", makeManifest(), {
			retryAttempts: 5,
			retryDelayMs: 1,
		});

		expect(result).toBeErr();
		expect(renameSpy).toHaveBeenCalledTimes(1);
	});

	it("cleans up the temp file when the initial write fails", async () => {
		vi.spyOn(vol.promises, "writeFile").mockImplementation(async () => {
			throw errnoException("ENOSPC");
		});

		const result = await writeManifest("/downloads", makeManifest());

		expect(result).toBeErr();
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(ManifestError);
		expect(vol.existsSync("/downloads")).toBe(true);
		expect(vol.readdirSync("/downloads")).toEqual([]);
	});
});

describe("readManifest", () => {
	beforeEach(() => {
		vol.reset();
	});

	it("returns the parsed manifest when valid", async () => {
		const manifest = makeManifest();
		vol.fromJSON({ "/downloads/manifest.json": JSON.stringify(manifest) });

		const result = await readManifest("/downloads");

		expect(result).toEqual({ status: "ok", manifest });
	});

	it("returns missing when the manifest file does not exist", async () => {
		const result = await readManifest("/downloads");

		expect(result).toEqual({ status: "missing" });
	});

	it("returns invalid for malformed JSON", async () => {
		vol.fromJSON({ "/downloads/manifest.json": "{not json" });

		const result = await readManifest("/downloads");

		expect(result.status).toBe("invalid");
		expect(result.status === "invalid" && result.error).toBeInstanceOf(ManifestError);
	});

	it("returns invalid for JSON that does not match the schema", async () => {
		vol.fromJSON({ "/downloads/manifest.json": JSON.stringify({ hello: "world" }) });

		const result = await readManifest("/downloads");

		expect(result.status).toBe("invalid");
		expect(result.status === "invalid" && result.error).toBeInstanceOf(ManifestError);
	});
});

describe("mintVersionId", () => {
	it("formats as a UTC compact timestamp", () => {
		const versionId = mintVersionId(new Date("2026-07-14T15:30:45.000Z"));
		expect(versionId).toBe("20260714T153045Z");
	});

	it("matches the expected pattern", () => {
		expect(mintVersionId(new Date("2026-01-05T09:05:03.000Z"))).toMatch(/^\d{8}T\d{6}Z$/);
	});

	it("sorts lexically in chronological order", () => {
		const earlier = mintVersionId(new Date("2026-07-14T15:30:45.000Z"));
		const later = mintVersionId(new Date("2026-07-14T16:30:45.000Z"));
		expect([later, earlier].sort()).toEqual([earlier, later]);
	});
});
