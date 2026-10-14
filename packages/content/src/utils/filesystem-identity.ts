import { lstat, mkdtemp, readdir, readlink, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function isMissingPath(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

interface PhysicalPath {
	existingPath: string;
	missingSuffix: string;
}

/** Resolve existing ancestors and symlink targets even when the final suffix is absent. */
async function physicalPath(filePath: string, remainingLinks = 40): Promise<PhysicalPath> {
	try {
		return { existingPath: await realpath(filePath), missingSuffix: "" };
	} catch (error) {
		if (!isMissingPath(error) || path.dirname(filePath) === filePath) throw error;
	}
	const parent = await physicalPath(path.dirname(filePath), remainingLinks);
	const missingSuffix = path.join(parent.missingSuffix, path.basename(filePath));
	const candidate = path.join(parent.existingPath, missingSuffix);
	try {
		if (!(await lstat(candidate)).isSymbolicLink()) {
			return { existingPath: await realpath(candidate), missingSuffix: "" };
		}
	} catch (error) {
		if (isMissingPath(error)) return { existingPath: parent.existingPath, missingSuffix };
		throw error;
	}
	if (remainingLinks === 0) throw new Error(`Too many symbolic links resolving ${filePath}`);
	const target = await readlink(candidate);
	return physicalPath(path.resolve(path.dirname(candidate), target), remainingLinks - 1);
}

async function existingDirectory(filePath: string): Promise<string> {
	try {
		if ((await stat(filePath)).isDirectory()) return realpath(filePath);
	} catch (error) {
		if (!isMissingPath(error) || path.dirname(filePath) === filePath) throw error;
	}
	return existingDirectory(path.dirname(filePath));
}

async function entryCaseSensitivity(directory: string, name: string): Promise<boolean | undefined> {
	const alternate = name === name.toLowerCase() ? name.toUpperCase() : name.toLowerCase();
	if (alternate === name) return undefined;
	const originalPath = path.join(directory, name);
	const alternatePath = path.join(directory, alternate);
	const original = await lstat(originalPath);
	if (original.isSymbolicLink()) return undefined;
	try {
		const alias = await lstat(alternatePath);
		// A different entry type proves these are distinct names, not an insensitive alias.
		if (alias.isSymbolicLink()) return true;
		if (original.ino !== alias.ino || original.dev !== alias.dev) return true;
		// Distinct hard links have the same inode, but different real paths.
		return (await realpath(originalPath)) !== (await realpath(alternatePath));
	} catch (error) {
		if (isMissingPath(error)) return true;
		throw error;
	}
}

/** Only entries inside the directory measure its filesystem, including at mount points. */
async function readCaseSensitivity(directory: string): Promise<boolean | undefined> {
	for (const name of await readdir(directory)) {
		const sensitive = await entryCaseSensitivity(directory, name);
		if (sensitive !== undefined) return sensitive;
	}
	return undefined;
}

async function detectCaseSensitivity(directory: string): Promise<boolean> {
	const measured = await readCaseSensitivity(directory);
	if (measured !== undefined) return measured;
	const probe = await mkdtemp(path.join(directory, ".launchpad-case-"));
	try {
		await writeFile(path.join(probe, "probe"), "");
		try {
			const original = await stat(path.join(probe, "probe"));
			const upper = await stat(path.join(probe, "PROBE"));
			return original.ino !== upper.ino || original.dev !== upper.dev;
		} catch (error) {
			if (isMissingPath(error)) return true;
			throw error;
		}
	} finally {
		await rm(probe, { recursive: true, force: true });
	}
}

/** Physical path identities with consistent, measured case folding before and after creation. */
export class FilesystemIdentity {
	private readonly sensitivity = new Map<string, Promise<boolean>>();

	async resolve(filePath: string): Promise<string> {
		const { existingPath, missingSuffix } = await physicalPath(path.resolve(filePath));
		const canonicalPrefix = await this.canonicalExistingPath(existingPath);
		if (!missingSuffix) return canonicalPrefix;
		const directory = await existingDirectory(existingPath);
		let sensitive = this.sensitivity.get(directory);
		if (!sensitive) {
			sensitive = detectCaseSensitivity(directory);
			this.sensitivity.set(directory, sensitive);
		}
		const suffix = (await sensitive) ? missingSuffix : missingSuffix.normalize("NFC").toLowerCase();
		return path.join(canonicalPrefix, suffix);
	}

	private async canonicalExistingPath(filePath: string): Promise<string> {
		const parent = path.dirname(filePath);
		if (parent === filePath) return filePath;
		const canonicalParent = await this.canonicalExistingPath(parent);
		const name = path.basename(filePath);
		const folded = name.normalize("NFC").toLowerCase();
		if (folded === name) return path.join(canonicalParent, name);
		let sensitive = this.sensitivity.get(parent);
		if (!sensitive) {
			// The entry's name belongs to its parent filesystem, not a possible mounted child.
			// Existing dependencies never need a writable case probe.
			sensitive = entryCaseSensitivity(parent, name).then(async (measured) => {
				const result = measured ?? (await readCaseSensitivity(parent));
				if (result === undefined) throw new Error(`Cannot measure filesystem case at ${parent}`);
				return result;
			});
			this.sensitivity.set(parent, sensitive);
		}
		return path.join(canonicalParent, (await sensitive) ? name : folded);
	}
}
