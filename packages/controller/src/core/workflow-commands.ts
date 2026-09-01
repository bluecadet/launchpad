/**
 * Controller-owned workflow commands.
 *
 * Both ids share the `workflow.` prefix so a single token-role glob
 * (`workflow.*`) covers them, even though the owning plugin and its state slice
 * are named `workflows`.
 */

import { z } from "zod";
import type { WorkflowRun } from "./workflow-state.js";

/**
 * Runs a config-declared workflow by name.
 *
 * Name only, never inline steps: allowlisting `workflow.run` grants exactly the
 * recipes in that Node's config and nothing a client can compose itself.
 */
export const workflowRunCommandSchema = z.object({
	type: z.literal("workflow.run"),
	name: z.string().min(1),
});

export const workflowListCommandSchema = z.object({
	type: z.literal("workflow.list"),
});

export const workflowCommandSchema = z.discriminatedUnion("type", [
	workflowRunCommandSchema,
	workflowListCommandSchema,
]);

export type WorkflowRunCommand = z.infer<typeof workflowRunCommandSchema>;
export type WorkflowListCommand = z.infer<typeof workflowListCommandSchema>;
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;

export type WorkflowListEntry = {
	name: string;
	stepCount: number;
	/** The latest run of this workflow, or `null` if it hasn't run this process. */
	lastRun: WorkflowRun | null;
};

export type WorkflowListResult = {
	workflows: WorkflowListEntry[];
};
