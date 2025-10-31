import { createMockEventBus, createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedContentConfig } from "../../content-config.js";
import type { ContentPluginDriver } from "../../content-plugin.js";
import { defineSource } from "../../source.js";
import type { DataStore } from "../../utils/data-store.js";
import type { FetchStageContext } from "../fetch-context.js";

describe("FetchStageContext", () => {
	const mockLogger = createMockLogger();
	const mockEventBus = createMockEventBus();

	beforeEach(() => {
		vi.clearAllMocks();
		mockEventBus.clearEvents();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	const createMockPluginDriver = (): ContentPluginDriver => {
		return {
			runHookSequential: vi.fn(),
			runHookParallel: vi.fn(),
		} as any;
	};

	const createMockDataStore = (): DataStore => {
		return {
			createNamespace: vi.fn(),
			namespace: vi.fn(),
			close: vi.fn(),
			allDocuments: vi.fn(() => []),
		} as any;
	};

	const createBasicConfig = (
		overrides: Partial<ResolvedContentConfig> = {},
	): ResolvedContentConfig => {
		return {
			downloadPath: "/downloads",
			tempPath: "/temp",
			backupPath: "/backups",
			keep: [],
			backupAndRestore: false,
			...overrides,
		} as ResolvedContentConfig;
	};

	describe("FetchStageContext properties", () => {
		it("should have immutable configuration", () => {
			const config = createBasicConfig();
			const context: FetchStageContext = {
				config,
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				eventBus: mockEventBus,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: (sourceId?: string) => `/downloads/${sourceId || ""}`.replace(/\/$/, ""),
				getTempPath: (sourceId?: string) => `/temp/${sourceId || ""}`.replace(/\/$/, ""),
				getBackupPath: (sourceId?: string) => `/backups/${sourceId || ""}`.replace(/\/$/, ""),
				sources: [],
			};

			expect(context.config).toBe(config);
			expect(context.cwd).toBe("/project");
			expect(context.logger).toBe(mockLogger);
		});

		it("should have mutable plugin driver and data store", () => {
			const pluginDriver1 = createMockPluginDriver();
			const dataStore1 = createMockDataStore();
			const pluginDriver2 = createMockPluginDriver();
			const dataStore2 = createMockDataStore();

			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: pluginDriver1,
				dataStore: dataStore1,
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.pluginDriver).toBe(pluginDriver1);
			expect(context.dataStore).toBe(dataStore1);

			// Can be reassigned
			context.pluginDriver = pluginDriver2;
			context.dataStore = dataStore2;

			expect(context.pluginDriver).toBe(pluginDriver2);
			expect(context.dataStore).toBe(dataStore2);
		});

		it("should have optional event bus", () => {
			const contextWithEventBus: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				eventBus: mockEventBus,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(contextWithEventBus.eventBus).toBe(mockEventBus);

			const contextWithoutEventBus: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(contextWithoutEventBus.eventBus).toBeUndefined();
		});
	});

	describe("Path resolution functions", () => {
		it("should resolve download paths for sources", () => {
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: (sourceId?: string) =>
					sourceId ? `/downloads/${sourceId}` : "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.getDownloadPath()).toBe("/downloads");
			expect(context.getDownloadPath("source1")).toBe("/downloads/source1");
			expect(context.getDownloadPath("source-with-dashes")).toBe("/downloads/source-with-dashes");
		});

		it("should resolve temp paths for sources and plugins", () => {
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: (sourceId?: string, pluginName?: string) => {
					if (sourceId && pluginName) {
						return `/temp/${sourceId}/${pluginName}`;
					}
					if (sourceId) {
						return `/temp/${sourceId}`;
					}
					return "/temp";
				},
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.getTempPath()).toBe("/temp");
			expect(context.getTempPath("source1")).toBe("/temp/source1");
			expect(context.getTempPath("source1", "plugin1")).toBe("/temp/source1/plugin1");
		});

		it("should resolve backup paths for sources", () => {
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: (sourceId?: string) => (sourceId ? `/backups/${sourceId}` : "/backups"),
				sources: [],
			};

			expect(context.getBackupPath()).toBe("/backups");
			expect(context.getBackupPath("source1")).toBe("/backups/source1");
			expect(context.getBackupPath("another-source")).toBe("/backups/another-source");
		});
	});

	describe("Sources array", () => {
		it("should have empty sources initially", () => {
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.sources).toHaveLength(0);
		});

		it("should hold resolved sources", () => {
			const source1 = defineSource({ id: "source1", fetch: () => [] });
			const source2 = defineSource({ id: "source2", fetch: () => [] });

			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [source1, source2],
			};

			expect(context.sources).toHaveLength(2);
			expect(context.sources[0]).toBe(source1);
			expect(context.sources[1]).toBe(source2);
		});

		it("should be mutable", () => {
			const source1 = defineSource({ id: "source1", fetch: () => [] });
			const source2 = defineSource({ id: "source2", fetch: () => [] });

			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [source1],
			};

			expect(context.sources).toHaveLength(1);
			context.sources.push(source2);
			expect(context.sources).toHaveLength(2);
		});
	});

	describe("Abort signal", () => {
		it("should have abort signal for cancellation", () => {
			const controller = new AbortController();
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: controller.signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.abortSignal.aborted).toBe(false);

			controller.abort();
			expect(context.abortSignal.aborted).toBe(true);
		});

		it("should handle abort event listeners", () => {
			const controller = new AbortController();
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: controller.signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			const abortListener = vi.fn();
			context.abortSignal.addEventListener("abort", abortListener);

			controller.abort();
			expect(abortListener).toHaveBeenCalled();
		});
	});

	describe("Configuration access", () => {
		it("should provide access to all config properties", () => {
			const config = createBasicConfig({
				keep: ["*.json", "important/**"],
				backupAndRestore: true,
			});

			const context: FetchStageContext = {
				config,
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.config.keep).toEqual(["*.json", "important/**"]);
			expect(context.config.backupAndRestore).toBe(true);
			expect(context.config.downloadPath).toBe("/downloads");
			expect(context.config.tempPath).toBe("/temp");
			expect(context.config.backupPath).toBe("/backups");
		});
	});

	describe("Logger access", () => {
		it("should have logger for logging operations", () => {
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.logger).toBe(mockLogger);
			context.logger.debug("test");
			expect(mockLogger.debug).toHaveBeenCalledWith("test");
		});
	});

	describe("Plugin driver interaction", () => {
		it("should have plugin driver for hook execution", () => {
			const pluginDriver = createMockPluginDriver();
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver,
				dataStore: createMockDataStore(),
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.pluginDriver).toBe(pluginDriver);
		});
	});

	describe("Data store interaction", () => {
		it("should have data store for content operations", () => {
			const dataStore = createMockDataStore();
			const context: FetchStageContext = {
				config: createBasicConfig(),
				cwd: "/project",
				logger: mockLogger,
				abortSignal: new AbortController().signal,
				pluginDriver: createMockPluginDriver(),
				dataStore,
				getDownloadPath: () => "/downloads",
				getTempPath: () => "/temp",
				getBackupPath: () => "/backups",
				sources: [],
			};

			expect(context.dataStore).toBe(dataStore);
		});
	});
});
