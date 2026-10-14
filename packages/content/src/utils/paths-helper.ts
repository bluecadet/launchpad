import path from "node:path";
import type { ResolvedContentConfig } from "../content-config.js";
import { FilesystemIdentity } from "./filesystem-identity.js";

export interface PathsHelper {
	getDownloadPath(sourceId?: string): string;
	getPublishedDownloadPath(sourceId?: string): string;
	getStagedDownloadPath(sourceId?: string): string;
	getTempPath(sourceId?: string, pluginName?: string): string;
	getBackupPath(sourceId?: string): string;
	getRunPath(...segments: string[]): string;
}

/** Source IDs are portable directory names, never paths. */
export function isSafeSourceId(sourceId: string): boolean {
	return (
		sourceId.length > 0 &&
		sourceId !== "." &&
		sourceId !== ".." &&
		!/[\\/:]/.test(sourceId) &&
		!sourceId.includes(String.fromCharCode(0)) &&
		!path.isAbsolute(sourceId)
	);
}

function resolveOptionalChild(basePath: string, child?: string) {
	if (child === undefined) return basePath;
	if (!isSafeSourceId(child)) throw new Error(`Invalid source directory name: ${child}`);
	return path.resolve(basePath, child);
}

export function createPathsHelper(
	resolvedConfig: ResolvedContentConfig,
	cwd: string,
	options?: {
		runId?: string;
	},
): PathsHelper {
	const publishedDownloadRoot = path.resolve(cwd, resolvedConfig.downloadPath);
	const tempRoot = path.resolve(cwd, resolvedConfig.tempPath);
	const runRoot = options?.runId ? path.resolve(tempRoot, "runs", options.runId) : tempRoot;
	const stagedDownloadRoot = options?.runId
		? path.resolve(runRoot, "downloads")
		: publishedDownloadRoot;

	return {
		getDownloadPath(sourceId?: string): string {
			return resolveOptionalChild(stagedDownloadRoot, sourceId);
		},
		getPublishedDownloadPath(sourceId?: string): string {
			return resolveOptionalChild(publishedDownloadRoot, sourceId);
		},
		getStagedDownloadPath(sourceId?: string): string {
			return resolveOptionalChild(stagedDownloadRoot, sourceId);
		},
		getTempPath(sourceId?: string, pluginName?: string): string {
			if (pluginName) {
				return resolveOptionalChild(path.resolve(runRoot, pluginName), sourceId);
			}
			return resolveOptionalChild(runRoot, sourceId);
		},
		getBackupPath(sourceId?: string): string {
			const backupRoot = path.resolve(cwd, resolvedConfig.backupPath);
			return resolveOptionalChild(backupRoot, sourceId);
		},
		getRunPath(...segments: string[]): string {
			return path.resolve(runRoot, ...segments);
		},
	};
}

/** Project-wide metadata and writer lease, independent of output and temp configuration. */
export function getProjectCachePaths(cwd: string) {
	const directory = path.resolve(cwd, ".launchpad", "cache");
	return {
		directory,
		database: path.join(directory, "artifacts.sqlite"),
		untrusted: path.join(directory, "untrusted"),
		lock: path.resolve(cwd, ".launchpad", "content-writer.lock"),
	};
}

function overlapsDirectory(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
	);
}

/** Configured destructive trees must never overlap fixed project cache metadata or its lease. */
export async function validateContentDirectories(
	config: ResolvedContentConfig,
	cwd: string,
): Promise<void> {
	const cache = getProjectCachePaths(cwd);
	const identity = new FilesystemIdentity();
	const protectedDirectory = await identity.resolve(cache.directory);
	const protectedLock = await identity.resolve(cache.lock);
	for (const configuredPath of [config.tempPath, config.downloadPath, config.backupPath]) {
		const directory = await identity.resolve(path.resolve(cwd, configuredPath));
		if (
			overlapsDirectory(directory, protectedDirectory) ||
			overlapsDirectory(protectedDirectory, directory) ||
			overlapsDirectory(directory, protectedLock) ||
			overlapsDirectory(protectedLock, directory)
		) {
			throw new Error(`Content directory overlaps protected project metadata: ${configuredPath}`);
		}
	}
}
