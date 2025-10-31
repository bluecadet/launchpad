/**
 * Content subsystem state exported for public API.
 */

import { PatchedStateManager } from "@bluecadet/launchpad-utils/state-patcher";
import type { ContentError } from "./content-plugin-driver.js";
// need to import so declaration merging works
import "@bluecadet/launchpad-utils/types";

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

export type ContentState = ContentPhase & {
	sources: Record<string, SourceFetchState>;
};

declare module "@bluecadet/launchpad-utils/types" {
	interface SubsystemsState {
		content: ContentState;
	}
}

export class ContentStateManager extends PatchedStateManager<ContentState> {
	constructor() {
		super({
			phase: "idle",
			sources: {},
		});
	}

	setPhase(newPhase: ContentPhase): void {
		this.updateState((draft) => {
			Object.assign(draft, newPhase);
		});
	}

	initializeSources(sourceIds: string[]): void {
		this.updateState((draft) => {
			for (const id of sourceIds) {
				if (!draft.sources[id]) {
					draft.sources[id] = { state: "pending" };
				}
			}
		});
	}

	markSourceFetching(sourceId: string): void {
		this.updateState((draft) => {
			draft.sources[sourceId] = {
				state: "fetching",
				startTime: new Date(),
			};
		});
	}

	markSourceSuccess(sourceId: string): void {
		this.updateState((draft) => {
			const source = draft.sources[sourceId];
			if (source && source.state === "fetching") {
				const finishedAt = new Date();
				const newState = {
					state: "success" as const,
					startTime: source.startTime,
					finishedAt,
					duration: finishedAt.getTime() - source.startTime.getTime(),
				};
				draft.sources[sourceId] = newState;
			}
		});
	}

	markSourceError(sourceId: string, error: Error): void {
		this.updateState((draft) => {
			const source = draft.sources[sourceId];
			const now = new Date();
			draft.sources[sourceId] = {
				state: "error",
				error,
				startTime: source && source.state === "fetching" ? source.startTime : undefined,
				attemptedAt: now,
				restored: false,
			};
		});
	}

	markSourceRestored(sourceId: string): void {
		this.updateState((draft) => {
			const source = draft.sources[sourceId];
			if (source && source.state === "error") {
				draft.sources[sourceId] = {
					...source,
					restored: true,
				};
			}
		});
	}
}
