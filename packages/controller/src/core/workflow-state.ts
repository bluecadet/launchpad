import "@bluecadet/launchpad-utils/types";

/** A configured workflow, described without exposing its steps. */
export type WorkflowSummary = {
	name: string;
	stepCount: number;
};

export type WorkflowStepStatus = "success" | "error" | "skipped";

export type WorkflowStepResult = {
	index: number;
	/**
	 * The step's command type as written in config. Never its params and never
	 * its return value: a step can dispatch a command whose result carries data
	 * that must not reach the state store or the wire.
	 *
	 * Typed as `string` rather than `CommandId` because a step is free-form
	 * config, and an alias is recorded as written — the runner records the
	 * pre-dispatch type, not the registry's canonical id.
	 */
	command: string;
	status: WorkflowStepStatus;
	/** `0` for a skipped step. */
	durationMs: number;
	/** Failure message only; `null` unless `status` is `"error"`. */
	error: string | null;
};

export type WorkflowRunStatus = "running" | "success" | "error";

export type WorkflowRun = {
	/** Monotonic per controller process, from 1. Resets on daemon restart. */
	runId: number;
	name: string;
	status: WorkflowRunStatus;
	/** ISO 8601. */
	startedAt: string;
	/** ISO 8601, or `null` while running. */
	finishedAt: string | null;
	durationMs: number | null;
	stepCount: number;
	/** Grows as the run progresses; complete (skipped steps included) once finished. */
	steps: WorkflowStepResult[];
	/** Aggregated failure message; `null` on success or while running. */
	error: string | null;
};

export type WorkflowsState = {
	/** Configured workflows and their step counts, in config order. */
	available: WorkflowSummary[];
	/** Most recent run per workflow name. Latest only — no history. */
	runs: Partial<Record<string, WorkflowRun>>;
};

declare module "@bluecadet/launchpad-utils/types" {
	interface PluginsState {
		workflows: WorkflowsState;
	}
}
