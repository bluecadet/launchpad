import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { ResolvedContentConfig } from "../content-config.js";
import { ContentError } from "../content-transform.js";
import { readManifest, resolveManifestSourceRoots } from "../manifest.js";
import { RUN_LAYOUT } from "../utils/content-layout.js";
import { FilesystemIdentity } from "../utils/filesystem-identity.js";
import {
	isSafeSourceId,
	type PathsHelper,
	validateContentDirectories,
} from "../utils/paths-helper.js";

export type ClearOptions = {
	temp: boolean;
	backups: boolean;
	downloads: boolean;
	cache: boolean;
};
export type ClearPlan = {
	readonly directories: readonly string[];
	readonly emptyParents: readonly string[];
	readonly invalidateMetadata: boolean;
};

/** Drain every started filesystem operation before returning a planning failure or releasing the lease. */
async function drain<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
	const results = await Promise.allSettled(tasks);
	return results.map((result) => {
		if (result.status === "rejected") throw result.reason;
		return result.value;
	});
}

async function childDirectories(directory: string): Promise<string[]> {
	try {
		return (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(directory, entry.name));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
}

/** Destructive source targets may not redirect through a symlink inside the configured tree. */
async function validateTarget(root: string, target: string): Promise<void> {
	const relative = path.relative(root, target);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new ContentError(`Clear target escapes its configured root: ${target}`);
	}
	let current = root;
	for (const segment of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		try {
			if ((await lstat(current)).isSymbolicLink()) {
				throw new ContentError(`Clear target contains a symlink: ${current}`);
			}
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
			throw error;
		}
	}
}

/** Known layouts only: never infer namespace ownership from a source directory's basename. */
async function selectedTempPaths(
	sourceIds: readonly string[],
	paths: PathsHelper,
	config: ResolvedContentConfig,
): Promise<string[]> {
	const transformNames = new Set(config.transforms.map((transform) => transform.name));
	if ([...transformNames].some((name) => !isSafeSourceId(name))) {
		throw new ContentError("Transform temporary namespaces must be directory names, not paths");
	}
	const tempRoot = paths.getTempPath();
	const identity = new FilesystemIdentity();
	const targets: string[] = [];
	const addSourceLeaves = async (root: string, namespaces: ReadonlySet<string>, direct = false) => {
		const namespaceIdentities = new Set(
			await drain([...namespaces].map((name) => identity.resolve(path.join(root, name)))),
		);
		for (const sourceId of sourceIds) {
			const target = path.join(root, sourceId);
			if (namespaceIdentities.has(await identity.resolve(target))) continue;
			// Without a persisted layout descriptor a direct source tree with subdirectories
			// could equally be a historical transform namespace. Never delete that whole tree.
			if (direct && (await childDirectories(target)).length > 0) {
				throw new ContentError(
					`Ambiguous temporary source directory: ${target}; use an all-source temp clear`,
				);
			}
			targets.push(target);
		}
	};
	await addSourceLeaves(tempRoot, new Set(["runs", ...transformNames]), true);
	for (const name of transformNames) {
		// 'runs' is the run container, never a legacy transform namespace (including case aliases).
		if (
			(await identity.resolve(path.join(tempRoot, name))) !==
			(await identity.resolve(path.join(tempRoot, "runs")))
		) {
			await addSourceLeaves(path.join(tempRoot, name), new Set());
		}
	}
	for (const run of await childDirectories(path.join(tempRoot, "runs"))) {
		await addSourceLeaves(run, new Set([...Object.values(RUN_LAYOUT), ...transformNames]), true);
		for (const name of new Set([RUN_LAYOUT.downloads, RUN_LAYOUT.recovery, ...transformNames])) {
			await addSourceLeaves(path.join(run, name), new Set());
		}
	}
	return [...new Set(targets)];
}

async function publishedSourcePaths(
	sourceIds: readonly string[],
	paths: PathsHelper,
	config: ResolvedContentConfig,
): Promise<string[]> {
	if (!config.versioning)
		return sourceIds.map((sourceId) => paths.getPublishedDownloadPath(sourceId));
	const active = await readManifest(paths.getPublishedDownloadPath());
	if (active.status === "invalid") throw active.error;
	if (active.status === "missing") return [];
	const roots = await resolveManifestSourceRoots(paths.getPublishedDownloadPath(), active.manifest);
	return active.manifest.sources
		.filter((source) => sourceIds.includes(source.sourceId))
		.map((source) => {
			if (source.path !== source.sourceId)
				throw new ContentError(`Cannot safely clear aliased source path for ${source.sourceId}`);
			const root = roots.get(source.sourceId);
			if (!root) throw new ContentError(`Manifest source root missing: ${source.sourceId}`);
			return root;
		});
}

/** Resolve and validate every requested target before invalidation or filesystem mutation. */
export async function buildClearPlan(
	sourceIds: readonly string[],
	allSources: boolean,
	options: ClearOptions,
	paths: PathsHelper,
	config: ResolvedContentConfig,
	cwd: string,
): Promise<ClearPlan> {
	await validateContentDirectories(config, cwd);
	const [downloads = [], temp = []] = await drain([
		options.downloads ? publishedSourcePaths(sourceIds, paths, config) : Promise.resolve([]),
		options.temp && !allSources
			? selectedTempPaths(sourceIds, paths, config)
			: Promise.resolve(options.temp ? [paths.getTempPath()] : []),
	]);
	const backups = options.backups ? sourceIds.map((sourceId) => paths.getBackupPath(sourceId)) : [];
	await drain([
		...downloads.map((target) => validateTarget(paths.getPublishedDownloadPath(), target)),
		...temp.map((target) => validateTarget(paths.getTempPath(), target)),
		...backups.map((target) => validateTarget(paths.getBackupPath(), target)),
	]);
	return {
		directories: [...new Set([...downloads, ...temp, ...backups])],
		emptyParents: [
			...(options.temp ? [paths.getTempPath()] : []),
			...(options.backups ? [paths.getBackupPath()] : []),
			...(options.downloads ? [paths.getPublishedDownloadPath()] : []),
		],
		invalidateMetadata: options.downloads || options.cache,
	};
}
