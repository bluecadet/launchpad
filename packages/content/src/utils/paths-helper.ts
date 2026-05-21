import path from "node:path";
import type { ResolvedContentConfig } from "../content-config.js";

export interface PathsHelper {
	getDownloadPath(sourceId?: string): string;
	getPublishedDownloadPath(sourceId?: string): string;
	getStagedDownloadPath(sourceId?: string): string;
	getTempPath(sourceId?: string, pluginName?: string): string;
	getBackupPath(sourceId?: string): string;
	getRunPath(...segments: string[]): string;
}

function resolveOptionalChild(basePath: string, child?: string) {
	return child ? path.resolve(basePath, child) : basePath;
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
				return sourceId
					? path.resolve(runRoot, pluginName, sourceId)
					: path.resolve(runRoot, pluginName);
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
