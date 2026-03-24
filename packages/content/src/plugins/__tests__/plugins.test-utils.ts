import path from "node:path";
import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { vol } from "memfs";
import { afterEach, vi } from "vitest";
import { contentConfigSchema } from "../../content-config.js";
import type { ContentTransformContext } from "../../content-transform.js";
import { DataStore } from "../../utils/data-store.js";

afterEach(() => {
	vol.reset();
});

/**
 * Creates a test context with a DataStore and logger
 */
export async function createTestPluginContext({
	logger = createMockLogger(),
}: {
	namespaces?: string[];
	logger?: Logger;
} = {}): Promise<ContentTransformContext> {
	const data = new DataStore("/");

	return {
		data,
		logger,
		abortSignal: new AbortController().signal,
		cwd: "/",
		eventBus: createMockEventBus(),
		paths: {
			getDownloadPath: vi
				.fn()
				.mockImplementation((sourceId?: string) => path.resolve("download", sourceId || "")),
			getTempPath: vi
				.fn()
				.mockImplementation((sourceId?: string) => path.resolve("temp", sourceId || "")),
			getBackupPath: vi
				.fn()
				.mockImplementation((sourceId?: string) => path.resolve("backup", sourceId || "")),
		},
		contentOptions: await contentConfigSchema.parseAsync({}),
	};
}
