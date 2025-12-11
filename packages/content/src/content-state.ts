/**
 * Content subsystem state exported for public API.
 */

import { PatchedStateManager } from "@bluecadet/launchpad-utils/state-patcher";
import type { ContentError } from "./content-plugin.js";
// need to import so declaration merging works
import "@bluecadet/launchpad-utils/types";

// all of these phases share the startedAt property
export type ContentInProgressPhase = {
	startedAt: Date;
} & (
	| {
			phase: "setup";
	  }
	| {
			phase: "backup";
	  }
	| {
			phase: "clearing";
	  }
	| {
			phase: "fetching";
	  }
	| {
			phase: "transforming";
	  }
	| {
			phase: "finalizing";
	  }
	| {
			phase: "cleanup";
	  }
);

export type ContentPhase =
	| {
			phase: "idle";
	  }
	| ContentInProgressPhase
	| {
			phase: "error";
			error: ContentError;
			attemptedAt: Date;
			restored: boolean;
	  }
	| {
			phase: "done";
			finishedAt: Date;
			duration: number;
	  };

export type ContentState = {
	sources: Record<string, ContentPhase>;
};

declare module "@bluecadet/launchpad-utils/types" {
	interface SubsystemsState {
		content: ContentState;
	}
}

export class ContentStateManager extends PatchedStateManager<ContentState> {
	constructor() {
		super({
			sources: {},
		});
	}

	initializeSources(sourceIds: string[]): void {
		this.updateState((draft) => {
			for (const id of sourceIds) {
				if (!draft.sources[id]) {
					draft.sources[id] = { phase: "idle" };
				}
			}
		});
	}

	updateSourcesPhase(sourceIds: string[], newPhase: ContentPhase): void {
		this.updateState((draft) => {
			for (const id of sourceIds) {
				draft.sources[id] = newPhase;
			}
		});
	}
}
