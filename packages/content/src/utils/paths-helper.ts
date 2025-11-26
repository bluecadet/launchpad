import path from "node:path";
import type { ResolvedContentConfig } from "../content-config.js";

export interface PathsHelper {
	getDownloadPath(sourceId?: string): string;
	getTempPath(sourceId?: string, pluginName?: string): string;
	getBackupPath(sourceId?: string): string;
}

export function createPathsHelper(resolvedConfig: ResolvedContentConfig, cwd: string): PathsHelper {
	return {
		getDownloadPath(sourceId?: string): string {
			if (sourceId) {
				return path.resolve(cwd, resolvedConfig.downloadPath, sourceId);
			}
			return path.resolve(cwd, resolvedConfig.downloadPath);
		},
		getTempPath(sourceId?: string, pluginName?: string): string {
			if (pluginName) {
				if (sourceId) {
					return path.resolve(cwd, resolvedConfig.tempPath, pluginName, sourceId);
				}
				return path.resolve(cwd, resolvedConfig.tempPath, pluginName);
			}
			if (sourceId) {
				return path.resolve(cwd, resolvedConfig.tempPath, sourceId);
			}
			return path.resolve(cwd, resolvedConfig.tempPath);
		},
		getBackupPath(sourceId?: string): string {
			if (sourceId) {
				return path.resolve(cwd, resolvedConfig.backupPath, sourceId);
			}
			return path.resolve(cwd, resolvedConfig.backupPath);
		},
	};
}
