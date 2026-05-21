import { createMockEventBus } from "@bluecadet/launchpad-testing/test-utils.ts";
import { describe, expect, it, vi } from "vitest";
import { defineContentTransform } from "../content-transform.js";
import { DataStore } from "../utils/data-store.js";

describe("ContentTransform", () => {
	it("apply() is called with the correct context shape", async () => {
		const applyFn = vi.fn();
		const transform = defineContentTransform({
			name: "test-transform",
			apply: applyFn,
		});

		const data = new DataStore("/");
		const ctx = {
			data,
			logger: {
				info: vi.fn(),
				warn: vi.fn(),
				verbose: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				child: () => ctx.logger,
			},
			contentOptions: {} as any,
			paths: {
				getDownloadPath: vi.fn(),
				getPublishedDownloadPath: vi.fn(),
				getStagedDownloadPath: vi.fn(),
				getTempPath: vi.fn(),
				getBackupPath: vi.fn(),
				getRunPath: vi.fn(),
			},
			eventBus: createMockEventBus(),
			abortSignal: new AbortController().signal,
			cwd: "/",
		};

		await transform.apply(ctx);
		expect(applyFn).toHaveBeenCalledWith(ctx);
	});
});
