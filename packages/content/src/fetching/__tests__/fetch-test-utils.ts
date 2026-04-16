import {
	createMockEventBus,
	createMockLogger,
	type MockEventBus,
	type MockLogger,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import { ok, okAsync } from "neverthrow";
import { vi } from "vitest";
import type { ResolvedContentConfig } from "../../content-config.js";
import type { ContentTransform } from "../../content-transform.js";
import type { DataStore } from "../../utils/data-store.js";
import type { FetchStageContext } from "../fetch-context.js";

function createMockPathsHelper(
	config: ResolvedContentConfig,
	_cwd: string,
	runId: string,
): FetchStageContext["paths"] {
	return {
		getDownloadPath(sourceId?: string) {
			return sourceId
				? `${config.tempPath}/runs/${runId}/downloads/${sourceId}`
				: `${config.tempPath}/runs/${runId}/downloads`;
		},
		getPublishedDownloadPath(sourceId?: string) {
			return sourceId ? `${config.downloadPath}/${sourceId}` : config.downloadPath;
		},
		getStagedDownloadPath(sourceId?: string) {
			return sourceId
				? `${config.tempPath}/runs/${runId}/downloads/${sourceId}`
				: `${config.tempPath}/runs/${runId}/downloads`;
		},
		getTempPath(sourceId?: string, pluginName?: string) {
			const basePath = pluginName
				? `${config.tempPath}/runs/${runId}/${pluginName}`
				: `${config.tempPath}/runs/${runId}`;
			return sourceId ? `${basePath}/${sourceId}` : basePath;
		},
		getBackupPath(sourceId?: string) {
			return sourceId ? `${config.backupPath}/${sourceId}` : config.backupPath;
		},
		getRunPath(...segments: string[]) {
			const suffix = segments.length > 0 ? `/${segments.join("/")}` : "";
			return `${config.tempPath}/runs/${runId}${suffix}`;
		},
	} as unknown as FetchStageContext["paths"];
}

export const createMockDataStore = (): FetchStageContext["dataStore"] => {
	return {
		createNamespace: vi.fn(() => okAsync({} as never)),
		namespace: vi.fn(() =>
			ok({
				asyncAndThen: vi.fn((cb: (namespace: { insert: typeof okAsync }) => unknown) =>
					cb({ insert: vi.fn(() => okAsync(undefined)) as never }),
				),
			} as never),
		),
		close: vi.fn(() => okAsync(undefined)),
		_clear: vi.fn(),
	} as unknown as FetchStageContext["dataStore"];
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
	const runId = "test-run";
	const mockLogger = createMockLogger();
	const mockEventBus = createMockEventBus();
	return {
		config,
		cwd,
		logger: mockLogger,
		abortSignal: new AbortController().signal,
		runId,
		eventBus: mockEventBus,
		transforms: [] as ContentTransform[],
		dataStore: createMockDataStore(),
		paths: createMockPathsHelper(config, cwd, runId),
		sources: [],
		...overrides,
	} as unknown as FetchStageContext & {
		eventBus: MockEventBus;
		logger: MockLogger;
	};
};
