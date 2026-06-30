import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";

/**
 * A workflow step with explicit execution behavior.
 *
 * Workflows run every step best-effort by default and report an aggregated
 * failure at the end. Wrap a step in this form to opt into halting behavior.
 */
export interface WorkflowStepOptions {
	/** The command id (e.g. `"content.fetch"`) or full command to execute. */
	step: CommandId | BaseCommand;
	/**
	 * When true, a failure of this step halts the workflow and skips the
	 * remaining steps. Defaults to false.
	 */
	stopOnError?: boolean;
}

export type WorkflowStep = CommandId | BaseCommand | WorkflowStepOptions;
export type WorkflowMap = Partial<Record<string, readonly WorkflowStep[]>>;

// zod cannot express the `${string}.${string}` template-literal type, so the
// regex guarantees the dotted form and the transform restores the precise type.
const commandIdSchema = z
	.string()
	.regex(/^.+\..+$/, "Command id must be in 'namespace.command' form")
	.transform((value): CommandId => value as CommandId);
const commandSchema = z.union([commandIdSchema, z.looseObject({ type: z.string() })]);

/**
 * Canonical runtime validator for a {@link WorkflowStep}. Co-located with the
 * type so validation and {@link resolveWorkflowStep} share one definition of
 * what a step looks like.
 */
export const workflowStepSchema = z.union([
	commandSchema,
	z.looseObject({ step: commandSchema, stopOnError: z.boolean().optional() }),
]);

export interface ResolvedWorkflowStep {
	command: BaseCommand;
	stopOnError: boolean;
}

export function resolveWorkflowStep(step: WorkflowStep): ResolvedWorkflowStep {
	if (typeof step === "string") {
		return { command: { type: step }, stopOnError: false };
	}

	if ("type" in step) {
		return { command: step, stopOnError: false };
	}

	const command = typeof step.step === "string" ? { type: step.step } : step.step;
	return { command, stopOnError: step.stopOnError ?? false };
}
