/**
 * Minimal context passed to fetch stages.
 * Contains only what's needed for a specific fetch operation.
 * Everything should be traceable back to LaunchpadContent for clarity.
 */

import type { EventBus } from "@bluecadet/launchpad-utils/controller-interfaces";
import type { Logger } from "@bluecadet/launchpad-utils/log-manager";
import type { ResolvedContentConfig } from "../content-config.js";
import type { ContentPluginDriver } from "../content-plugin-driver.js";
import type { ContentSource } from "../sources/source.js";
import type { DataStore } from "../utils/data-store.js";

/**
 * Lightweight context for fetch pipeline stages.
 *
 * This context is created fresh for each fetch operation:
 * - config, logger, cwd: Come from LaunchpadContent.constructor
 * - pluginDriver: Created in LaunchpadContent.constructor
 * - dataStore: Created fresh for each fetch in LaunchpadContent.start()
 * - Path functions: Bound methods from LaunchpadContent
 * - eventBus: Injected via setEventBus()
 * - sources: Set by LaunchpadContent._executeFetchPipeline()
 * - abortSignal: From LaunchpadContent._abortController
 *
 * Stages do NOT manage state - that's the pipeline's job.
 * Stages only do work and return results.
 */
export type FetchStageContext = {
	// Immutable configuration
	readonly config: ResolvedContentConfig;
	readonly cwd: string;
	readonly logger: Logger;
	readonly abortSignal: AbortSignal;

	// Optional event bus (injected by controller)
	readonly eventBus?: EventBus;

	// Mutable during fetch - created fresh for each fetch
	pluginDriver: ContentPluginDriver;
	dataStore: DataStore;

	// Path resolution functions (bound from LaunchpadContent)
	getDownloadPath: (sourceId?: string) => string;
	getTempPath: (sourceId?: string, pluginName?: string) => string;
	getBackupPath: (sourceId?: string) => string;

	// Resolved sources to fetch (set by pipeline orchestrator)
	sources: Array<ContentSource>;
};
