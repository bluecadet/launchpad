import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { Logger } from "@bluecadet/launchpad-utils";
import { vol } from "memfs";
import { vi } from "vitest";
import { afterEach } from "vitest";
import { type ContentConfig, resolveContentConfig } from "../../content-config.js";
import { DataStore } from "../../utils/data-store.js";

afterEach(() => {
	vol.reset();
});

/**
 * Creates a test context with a DataStore and logger
 */
export async function createTestPluginContext({
	baseOptions = {},
	logger = createMockLogger(),
}: { namespaces?: string[]; baseOptions?: ContentConfig; logger?: Logger } = {}) {
	const data = new DataStore("/");

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
