import type { BaseCommand, CommandId } from "@bluecadet/launchpad-utils/plugin-interfaces";

export type WorkflowStep = CommandId | BaseCommand;
export type WorkflowMap = Partial<Record<string, readonly WorkflowStep[]>>;

export function resolveWorkflowStep(step: WorkflowStep): BaseCommand {
	if (typeof step === "string") {
		return { type: step };
	}

	return step;
}
