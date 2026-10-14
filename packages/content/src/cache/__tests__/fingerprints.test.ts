import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	canonicalJson,
	contentKey,
	fingerprint,
	InputFingerprints,
	verifyFingerprint,
} from "../fingerprints.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

describe("artifact fingerprints (real files)", () => {
	let directory: string;
	let file: string;

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "launchpad-fingerprints-"));
		file = path.join(directory, "artifact");
		await writeFile(file, "original");
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("returns the expected fingerprint directly when size and mtime match", async () => {
		const expected = await fingerprint(file);
		expect(expected).toBeDefined();
		expect(await verifyFingerprint(file, expected!)).toBe(expected);
	});

	it("rehashes changed attributes and returns refreshed metadata when content is equal", async () => {
		const expected = await fingerprint(file);
		await utimes(file, new Date(1000), new Date(1000));
		const verified = await verifyFingerprint(file, expected!);
		expect(verified?.sha256).toBe(expected?.sha256);
		expect(verified?.mtimeMs).toBe(1000);
		expect(verified).not.toBe(expected);
	});

	it("misses for changed bytes, absent files, and directories", async () => {
		const expected = await fingerprint(file);
		await writeFile(file, "different");
		expect(await verifyFingerprint(file, expected!)).toBeUndefined();
		await rm(file);
		expect(await verifyFingerprint(file, expected!)).toBeUndefined();
		expect(await fingerprint(file)).toBeUndefined();
		expect(await fingerprint(directory)).toBeUndefined();
	});

	it("shares in-flight input hashing and uses a stat-only memo for unchanged inputs", async () => {
		const memo = new InputFingerprints();
		const first = memo.read(file);
		expect(memo.read(file)).toBe(first);
		const original = await first;
		expect(await memo.read(file)).toBe(original);
		await utimes(file, new Date(2000), new Date(2000));
		const refreshed = await memo.read(file);
		expect(refreshed).not.toBe(original);
		expect(refreshed?.sha256).toBe(original?.sha256);
		await writeFile(file, "changed input bytes");
		const changed = await memo.read(file);
		expect(changed?.sha256).not.toBe(original?.sha256);
		await rm(file);
		expect(await memo.read(file)).toBeUndefined();
	});

	it("canonicalizes nested JSON without conflating arrays or option values", () => {
		expect(canonicalJson({ z: { b: true, a: null }, a: [2, 1] })).toBe(
			'{"a":[2,1],"z":{"a":null,"b":true}}',
		);
		expect(contentKey({ b: 1, a: 2 })).toBe(contentKey({ a: 2, b: 1 }));
		expect(contentKey([1, 2])).not.toBe(contentKey([2, 1]));
		expect(contentKey({ a: "1" })).not.toBe(contentKey({ a: 1 }));
	});
});
