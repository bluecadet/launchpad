/**
 * Content subsystem state.
 * This represents the current state of the content system.
 */

export type ContentState = {
	/** Whether a fetch is currently in progress */
	isFetching: boolean;
	/** Timestamp of the last fetch start */
	lastFetchStart?: Date;
	/** Timestamp of the last successful fetch */
	lastFetchSuccess?: Date;
	/** Timestamp of the last fetch error */
	lastFetchError?: Date;
	/** Total number of sources configured */
	totalSources: number;
	/** Download path */
	downloadPath: string;
};
