import { describe, expect, it } from "vitest";
import { contentConfigSchema } from "../content-config.js";

describe("contentConfigSchema versioning", () => {
	it("defaults to false when versioning is absent", async () => {
		const resolved = await contentConfigSchema.parseAsync({});
		expect(resolved.versioning).toBe(false);
	});

	it("keeps every other field's defaults identical when versioning is absent (regression)", async () => {
		const resolved = await contentConfigSchema.parseAsync({});

		expect(resolved).toMatchObject({
			sources: [],
			transforms: [],
			downloadPath: ".downloads/",
			tempPath: ".launchpad/tmp/",
			backupPath: ".launchpad/backup/",
			keep: [],
			backupAndRestore: true,
			maxTimeout: 30000,
			encodeChars: '<>:"|?*',
			versioning: false,
		});
	});

	it("resolves versioning: false to false", async () => {
		const resolved = await contentConfigSchema.parseAsync({ versioning: false });
		expect(resolved.versioning).toBe(false);
	});

	it("resolves versioning: true to the options object with defaults", async () => {
		const resolved = await contentConfigSchema.parseAsync({ versioning: true });
		expect(resolved.versioning).toEqual({ keep: 3, ackTimeout: 1_800_000 });
	});

	it("resolves a partial versioning object, filling in defaults", async () => {
		const resolved = await contentConfigSchema.parseAsync({ versioning: { keep: 10 } });
		expect(resolved.versioning).toEqual({ keep: 10, ackTimeout: 1_800_000 });
	});

	it("parses duration shorthand for ackTimeout", async () => {
		const resolved = await contentConfigSchema.parseAsync({ versioning: { ackTimeout: "5m" } });
		expect(resolved.versioning).toEqual({ keep: 3, ackTimeout: 300_000 });
	});

	it("accepts a raw millisecond number for ackTimeout", async () => {
		const resolved = await contentConfigSchema.parseAsync({ versioning: { ackTimeout: 42 } });
		expect(resolved.versioning).toEqual({ keep: 3, ackTimeout: 42 });
	});

	it("rejects an invalid ackTimeout duration string", async () => {
		await expect(
			contentConfigSchema.parseAsync({ versioning: { ackTimeout: "soon" } }),
		).rejects.toThrow();
	});

	it("fully overrides both keep and ackTimeout", async () => {
		const resolved = await contentConfigSchema.parseAsync({
			versioning: { keep: 5, ackTimeout: "1h" },
		});
		expect(resolved.versioning).toEqual({ keep: 5, ackTimeout: 3_600_000 });
	});
});
