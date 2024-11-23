import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { Logger } from "@bluecadet/launchpad-utils";
import { vol } from "memfs";
import { vi } from "vitest";
import { afterEach } from "vitest";
import { type ContentConfig, contentConfigSchema } from "../../content-config.js";
import { DataStore } from "../../utils/data-store.js";
import path from "node:path";

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
			getDownloadPath: vi
				.fn()
				.mockImplementation((sourceId?: string) => path.join("/download", sourceId || "")),
			getTempPath: vi
				.fn()
				.mockImplementation((sourceId?: string) => path.join("/temp", sourceId || "")),
			getBackupPath: vi
				.fn()
				.mockImplementation((sourceId?: string) => path.join("/backup", sourceId || "")),
		},
		contentOptions: contentConfigSchema.parse(baseOptions),
	};
}
