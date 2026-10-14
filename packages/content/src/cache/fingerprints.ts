import { createHash } from "node:crypto";
import { lstat, open, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FilesystemIdentity } from "../utils/filesystem-identity.js";

export const fingerprintSchema = z.object({
	size: z.number().int().nonnegative(),
	mtimeMs: z.number().finite(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Fingerprint = z.infer<typeof fingerprintSchema>;
export type JsonValue = z.infer<ReturnType<typeof z.json>>;

function isMissingFile(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

/** Hash bytes from one opened file, rejecting files changed while being read. */
export async function fingerprint(filePath: string): Promise<Fingerprint | undefined> {
	try {
		const file = await open(filePath, "r");
		try {
			const before = await file.stat();
			if (!before.isFile()) return undefined;
			const hash = createHash("sha256");
			for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
			const after = await file.stat();
			if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return undefined;
			return { size: after.size, mtimeMs: after.mtimeMs, sha256: hash.digest("hex") };
		} finally {
			await file.close();
		}
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw error;
	}
}

async function refreshFingerprint(
	filePath: string,
	expected?: Fingerprint,
): Promise<Fingerprint | undefined> {
	try {
		if (expected) {
			const attributes = await stat(filePath);
			if (!attributes.isFile()) return undefined;
			if (attributes.size === expected.size && attributes.mtimeMs === expected.mtimeMs)
				return expected;
		}
		return fingerprint(filePath);
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		throw error;
	}
}

/** A matching stat avoids reading bytes; changed attributes require an equal hash. */
export async function verifyFingerprint(
	filePath: string,
	expected: Fingerprint,
): Promise<Fingerprint | undefined> {
	const actual = await refreshFingerprint(filePath, expected);
	return actual?.sha256 === expected.sha256 ? actual : undefined;
}

/** Run-scoped stat/hash memo; concurrent recipes share each input read. */
export class InputFingerprints {
	private readonly values = new Map<string, Fingerprint>();
	private readonly pending = new Map<string, Promise<Fingerprint | undefined>>();

	read(filePath: string): Promise<Fingerprint | undefined> {
		const resolved = path.resolve(filePath);
		const existing = this.pending.get(resolved);
		if (existing) return existing;
		const task = refreshFingerprint(resolved, this.values.get(resolved));
		this.pending.set(resolved, task);
		void task.then(
			(value) => {
				this.pending.delete(resolved);
				if (value) this.values.set(resolved, value);
				else this.values.delete(resolved);
			},
			() => {
				this.pending.delete(resolved);
				this.values.delete(resolved);
			},
		);
		return task;
	}
}

/** Stable JSON keys ensure option insertion order does not change artifact identity. */
export function canonicalJson(value: JsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
		.join(",")}}`;
}

export function contentKey(value: JsonValue): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Reject traversal and aliases so each claim names one relative output. */
export function resolveOutput(root: string, output: string): string {
	if (!output || path.isAbsolute(output))
		throw new Error(`Invalid artifact output path: ${output}`);
	const destination = path.resolve(root, output);
	const relative = path.relative(path.resolve(root), destination);
	if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)) {
		throw new Error(`Artifact output escapes its source root: ${output}`);
	}
	return destination;
}

export class UnsafeOutputError extends Error {
	constructor(filePath: string, reason = "symbolic link") {
		super(`Unsafe artifact output (${reason}): ${filePath}`);
		this.name = "UnsafeOutputError";
	}
}

/** Reject symlinks and multiply-linked leaf files; root ancestors belong to the caller. */
export async function safeOutput(root: string, output: string): Promise<string> {
	const destination = resolveOutput(root, output);
	const absoluteRoot = path.resolve(root);
	const components = [absoluteRoot];
	for (const component of path.relative(absoluteRoot, destination).split(path.sep)) {
		components.push(path.join(components[components.length - 1] ?? absoluteRoot, component));
	}
	for (const component of components) {
		try {
			const attributes = await lstat(component);
			if (attributes.isSymbolicLink()) throw new UnsafeOutputError(component);
			if (component === destination && attributes.isFile() && attributes.nlink > 1) {
				throw new UnsafeOutputError(component, "multiply-linked file");
			}
		} catch (error) {
			if (isMissingFile(error)) break;
			throw error;
		}
	}
	return destination;
}

/** Run-scoped filesystem case detection, preserving distinct names on case-sensitive volumes. */
export class OutputClaims {
	private readonly identity = new FilesystemIdentity();

	async resolve(root: string, output: string): Promise<string> {
		return this.identity.resolve(await safeOutput(root, output));
	}
}
