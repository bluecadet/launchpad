import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { DataStore } from "../../utils/data-store.js";
import { vi } from "vitest";
import { resolveContentConfig, type ContentConfig } from "../../content-config.js";
import type { Logger } from "@bluecadet/launchpad-utils";

/**
 * Creates a test context with a DataStore and logger
 */
export function createTestPluginContext({
	namespaces = ["test"],
	baseOptions = {},
	logger = createMockLogger(),
}: { namespaces?: string[]; baseOptions?: ContentConfig; logger?: Logger } = {}) {
	const data = new DataStore();
	for (const namespace of namespaces) {
		data.createNamespace(namespace);
	}

	return {
		data,
		logger,
		abortSignal: new AbortController().signal,
		paths: {
			getDownloadPath: vi.fn().mockReturnValue("/download"),
			getTempPath: vi.fn().mockReturnValue("/temp"),
			getBackupPath: vi.fn().mockReturnValue("/backup"),
		},
		contentOptions: resolveContentConfig(baseOptions),
	};
}
