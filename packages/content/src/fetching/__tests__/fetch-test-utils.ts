import {
	createMockEventBus,
	createMockLogger,
	type MockEventBus,
	type MockLogger,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import { okAsync } from "neverthrow";
import { vi } from "vitest";
import type { ResolvedContentConfig } from "../../content-config.js";
import { createPathsHelper } from "../../utils/paths-helper.js";
import type { FetchStageContext } from "../fetch-context.js";

export const createMockPluginDriver = () => {
	return {
		runHookSequential: vi.fn(() => okAsync(undefined)),
		runHookParallel: vi.fn(() => okAsync(undefined)),
	} as any;
};

export const createMockDataStore = () => {
	return {
		createNamespace: vi.fn(() => okAsync(undefined)),
		namespace: vi.fn(() => ({
			asyncAndThen: vi.fn((cb) => cb({ safeInsert: vi.fn(() => okAsync(undefined)) })),
		})),
		close: vi.fn(() => Promise.resolve()),
	} as any;
};

export const createMockContentConfig = (
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

export const createMockFetchContext = (overrides: Partial<FetchStageContext> = {}) => {
	const config = createMockContentConfig();
	const cwd = "/project";
	const mockLogger = createMockLogger();
	const mockEventBus = createMockEventBus();
	return {
		config: createMockContentConfig(),
		cwd,
		logger: mockLogger,
		abortSignal: new AbortController().signal,
		eventBus: mockEventBus,
		pluginDriver: createMockPluginDriver(),
		dataStore: createMockDataStore(),
		paths: createPathsHelper(config, cwd),
		sources: [],
		...overrides,
	} as Omit<FetchStageContext, "eventBus" | "logger"> & {
		eventBus: MockEventBus;
		logger: MockLogger;
	};
};
