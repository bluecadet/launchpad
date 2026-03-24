/**
 * Minimal context passed to fetch stages.
 * Contains only what's needed for a specific fetch operation.
 * Everything should be traceable back to LaunchpadContent for clarity.
 */

import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { ResolvedContentConfig } from "../content-config.js";
import type { ContentTransform } from "../content-transform.js";
import type { ContentSource } from "../source.js";
import type { DataStore } from "../utils/data-store.js";
import type { PathsHelper } from "../utils/paths-helper.js";

/**
 * Lightweight context for fetch pipeline stages.
 *
 * This context is created fresh for each fetch operation:
 * - config, logger, cwd: Come from LaunchpadContent.constructor
 * - transforms: From resolved config
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
	readonly eventBus: EventBus;

	// Mutable during fetch - created fresh for each fetch
	transforms: ContentTransform[];
	dataStore: DataStore;

	// Path resolution functions
	paths: PathsHelper;

	// Resolved sources to fetch (set by pipeline orchestrator)
	sources: Array<ContentSource>;
};
