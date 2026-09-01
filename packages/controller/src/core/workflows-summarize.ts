import type { Row, Section, Tone } from "@bluecadet/launchpad-utils/types";
import type { WorkflowRun, WorkflowsState } from "./workflow-state.js";

const ERROR_FRAGMENT_MAX_LENGTH = 80;

/** Sorts after Monitor (10), Content (20), and Scheduler (30). */
const WORKFLOWS_SECTION_ORDER = 40;

function truncateError(error: string): string {
	const firstLine = error.split(/\r?\n/, 1)[0] ?? "";
	return firstLine.length <= ERROR_FRAGMENT_MAX_LENGTH
		? firstLine
		: `${firstLine.slice(0, ERROR_FRAGMENT_MAX_LENGTH - 3)}...`;
}

function failureFragment(run: WorkflowRun): string {
	const failedStep = run.steps.find((step) => step.status === "error");
	if (!failedStep) {
		return `failed · ${truncateError(run.error ?? "Unknown error")}`;
	}
	const reason = truncateError(failedStep.error ?? run.error ?? "Unknown error");
	return `failed · step ${failedStep.index + 1} (${failedStep.command}): ${reason}`;
}

function runValue(run: WorkflowRun | undefined, stepCount: number): { value: string; tone: Tone } {
	if (!run) {
		return { value: `never run · ${stepCount} steps`, tone: "neutral" };
	}
	if (run.status === "running") {
		const current = Math.min(run.steps.length + 1, run.stepCount);
		return { value: `running · step ${current} of ${run.stepCount}`, tone: "neutral" };
	}
	if (run.status === "error") {
		return { value: failureFragment(run), tone: "error" };
	}
	return { value: `ok · ${run.stepCount} steps`, tone: "ok" };
}

/**
 * One row per configured workflow. Relative times are deliberately omitted:
 * the operator-facing question is "did it work", and the full record with
 * timestamps is in `plugins.workflows.runs`.
 */
export function buildWorkflowsSection(state: WorkflowsState): Section {
	const rows: Row[] = state.available.map(({ name, stepCount }) => {
		const { value, tone } = runValue(state.runs[name], stepCount);
		return { type: "kv", label: name, value, tone };
	});

	return { name: "workflows", order: WORKFLOWS_SECTION_ORDER, title: "Workflows", rows };
}
