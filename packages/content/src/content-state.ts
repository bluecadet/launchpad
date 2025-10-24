/**
 * Source-specific fetch state tracking.
 */
export type SourceState = {
	/** Source ID */
	id: string;
	/** Whether a fetch is currently in progress for this source */
	isFetching: boolean;
	/** Timestamp of the last fetch start for this source */
	lastFetchStart?: Date;
	/** Timestamp of the last successful fetch for this source */
	lastFetchSuccess?: Date;
	/** Timestamp of the last fetch error for this source */
	lastFetchError?: Date;
	/** Number of documents fetched in the last successful fetch */
	lastDocumentCount?: number;
};

/**
 * Content subsystem state.
 * This represents the current state of the content system.
 */

export type ContentState = {
	/** Per-source state tracking */
	sources: Record<string, SourceState>;
	/** Total number of sources configured */
	totalSources: number;
	/** Download path */
	downloadPath: string;
};

declare module "@bluecadet/launchpad-controller" {
	interface SubsystemsState {
		content: ContentState;
	}
}
