import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { ArtifactCache } from "../cache/artifact-cache.js";
import type { ResolvedContentConfig } from "../content-config.js";
import type { ContentTransform } from "../content-transform.js";
import type { ContentSource } from "../source.js";
import type { DataStore } from "../utils/data-store.js";
import type { PathsHelper } from "../utils/paths-helper.js";
import type { OutputStrategy, PublicationState } from "./output-strategy.js";

/** Fresh run-owned resources and publication state; plugin status belongs to fetch-run. */
export type FetchStageContext = {
	// Immutable configuration
	readonly config: ResolvedContentConfig;
	/** Output strategy resolved once from `config.versioning`; stages consult it for all mode-specific behavior. */
	readonly output: OutputStrategy;
	readonly cwd: string;
	readonly logger: Logger;
	readonly abortSignal: AbortSignal;
	readonly runId: string;

	// Controller infrastructure
	readonly eventBus: EventBus;

	// Mutable during fetch - created fresh for each fetch
	readonly cache: ArtifactCache;
	/** One immutable root snapshot shared by keep-file seeding and cache reuse. */
	seedRoots: ReadonlyMap<string, string>;
	publication: PublicationState;
	dataStoreClosed: boolean;
	readonly transforms: readonly ContentTransform[];
	readonly dataStore: DataStore;

	// Path resolution functions
	readonly paths: PathsHelper;

	// Resolved sources to fetch (set by pipeline orchestrator)
	readonly sources: readonly ContentSource[];
};
