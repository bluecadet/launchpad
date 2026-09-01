/**
 * Controller-internal plugin exposing config-declared workflows as commands.
 *
 * Registered by `LaunchpadController.start()` in both modes, before any host
 * plugin, so a host that tries to claim `workflow.run` fails registration with
 * the usual conflict error instead of silently shadowing a core command. The
 * plugin name `workflows` and the state key `plugins.workflows` are reserved.
 */

import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { WorkflowError } from "../errors.js";
import {
	type WorkflowCommand,
	type WorkflowListResult,
	workflowCommandSchema,
} from "./workflow-commands.js";
import type { WorkflowHost, WorkflowObserver } from "./workflow-runner.js";
import type { WorkflowRun, WorkflowSummary, WorkflowsState } from "./workflow-state.js";
import { buildWorkflowsSection } from "./workflows-summarize.js";

/**
 * Mirror of what the observer wrote into state. Reading the run back through
 * `ctx.getGlobalState()` would type the slice as possibly-undefined and cost an
 * Immer round-trip for a value this plugin just produced.
 */
type WorkflowMirror = {
	available: WorkflowSummary[];
	runs: Map<string, WorkflowRun>;
};

function buildListResult(mirror: WorkflowMirror): WorkflowListResult {
	return {
		workflows: mirror.available.map(({ name, stepCount }) => ({
			name,
			stepCount,
			lastRun: mirror.runs.get(name) ?? null,
		})),
	};
}

function describeRunFailure(name: string, run: WorkflowRun, error: Error): WorkflowError {
	const failedStep = run.steps.find((step) => step.status === "error");
	const detail = failedStep
		? `step ${failedStep.index + 1} (${failedStep.command}): ${failedStep.error ?? error.message}`
		: error.message;
	return new WorkflowError(`Workflow '${name}' failed: ${detail}`);
}

export function createWorkflowsPlugin(host: WorkflowHost) {
	return definePlugin({
		name: "workflows",
		manifest: {
			// Both ids use the `workflow.` prefix — not `workflows.` — so one token
			// role glob (`workflow.*`) covers them, even though the plugin and its
			// state slice are named `workflows`.
			commands: [
				{
					id: "workflow.run",
					description: "Run a config-declared workflow by name",
					parser: workflowCommandSchema,
				},
				{
					id: "workflow.list",
					description: "List config-declared workflows and their latest run",
					parser: workflowCommandSchema,
				},
			],
		},
		summarize(state: LaunchpadState): Section | null {
			const workflowsState = state.plugins.workflows;
			if (!workflowsState || workflowsState.available.length === 0) {
				return null;
			}
			return buildWorkflowsSection(workflowsState);
		},
		setup(ctx: PluginContext<WorkflowsState>) {
			const mirror: WorkflowMirror = { available: host.list(), runs: new Map() };
			ctx.updateState(() => ({ available: [...mirror.available], runs: {} }));

			// `setWorkflows()` runs after `start()`, so the slice seeded above is
			// empty on a real boot and only this subscription fills it in.
			const observer: WorkflowObserver = {
				workflowsChanged(summaries) {
					mirror.available = summaries.map((summary) => ({ ...summary }));
					ctx.updateState((draft) => {
						draft.available = summaries.map((summary) => ({ ...summary }));
					});
				},
				runUpdated(run) {
					mirror.runs.set(run.name, run);
					ctx.updateState((draft) => {
						draft.runs[run.name] = run;
					});
				},
			};
			const unsubscribe = host.subscribe(observer);

			const runWorkflow = (name: string): ResultAsync<WorkflowRun, Error> => {
				// The runner treats an unknown name as a silent no-op success, which
				// is right for the optional `start`/`stop` lifecycle workflows and
				// wrong here: a typo from a tablet must not look like a success.
				if (!host.has(name)) {
					return errAsync(new WorkflowError(`Unknown workflow '${name}'`));
				}

				// `runs[name]` holds one record per name, so a run that never started —
				// the runner refusing a second run of a workflow already in flight —
				// would otherwise be described with the *other* run's failed step. Run
				// ids are monotonic per process, so a changed id means the record under
				// this name is the one this call produced.
				const runIdBefore = mirror.runs.get(name)?.runId;
				const ownRun = (): WorkflowRun | undefined => {
					// The runner emits the finished record before `run()` settles.
					const run = mirror.runs.get(name);
					return run && run.runId !== runIdBefore ? run : undefined;
				};

				return host
					.run(name)
					.orElse((error) => {
						const run = ownRun();
						// Nothing of ours ran: surface the runner's own error verbatim.
						return errAsync(run ? describeRunFailure(name, run, error) : error);
					})
					.andThen(() => {
						const run = ownRun();
						return run
							? okAsync(run)
							: errAsync(new WorkflowError(`Workflow '${name}' produced no run record`));
					});
			};

			return okAsync({
				executeCommand(command: WorkflowCommand) {
					switch (command.type) {
						case "workflow.run":
							return runWorkflow(command.name);
						case "workflow.list":
							return okAsync(buildListResult(mirror));
						default: {
							command satisfies never;
							return errAsync(new WorkflowError("Unreachable: unknown command type"));
						}
					}
				},
				disconnect(_reason: DisconnectReason) {
					unsubscribe();
					return okAsync(undefined);
				},
			});
		},
	});
}
