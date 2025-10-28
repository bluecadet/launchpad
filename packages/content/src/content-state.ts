/**
 * Content subsystem state exported for public API.
 */

import type { ContentError } from "./content-plugin-driver.js";

/**
 * Individual source fetch state with explicit phase tracking.
 * Each phase has associated metadata that's only valid for that phase.
 */
export type SourceFetchState =
	| {
			state: "pending";
	  }
	| {
			state: "fetching";
			startTime: Date;
	  }
	| {
			state: "success";
			startTime: Date;
			finishedAt: Date;
			duration: number;
	  }
	| {
			state: "error";
			error: Error;
			startTime?: Date;
			attemptedAt: Date;
			restored: boolean;
	  };

/**
 * Overall content system phase with phase-specific metadata.
 */
export type ContentPhase =
	| {
			phase: "idle";
	  }
	| {
			phase: "resolving-sources";
	  }
	| {
			phase: "running-setup-hooks";
	  }
	| {
			phase: "backing-up";
	  }
	| {
			phase: "clearing-old-data";
	  }
	| {
			phase: "fetching-sources";
	  }
	| {
			phase: "running-done-hooks";
	  }
	| {
			phase: "finalizing";
			restored: boolean;
	  }
	| {
			phase: "error";
			error: ContentError;
			restored: boolean;
	  }
	| {
			phase: "clearing-temp";
	  };

/**
 * Immutable snapshot of content system state at a point in time.
 * Useful for observability, debugging, and state replay.
 */
export type ContentStateSnapshot = {
	readonly timestamp: Date;
	readonly phase: ContentPhase;
	readonly sources: ReadonlyRecord<string, SourceFetchState>;
	readonly totalSources: number;
	readonly downloadPath: string;
};

type ReadonlyRecord<K extends PropertyKey, V> = {
	readonly [P in K]: V;
};

declare module "@bluecadet/launchpad-utils" {
	interface SubsystemsState {
		content: ContentStateSnapshot;
	}
}
