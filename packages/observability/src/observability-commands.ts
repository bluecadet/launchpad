import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { z } from "zod";

export type ObservabilityFlushCommand = BaseCommand & {
	type: "observability.flush";
};

export type ObservabilityCommand = ObservabilityFlushCommand;

const observabilityFlushCommandSchema = z
	.object({
		type: z.literal("observability.flush"),
	})
	.strict();

export const observabilityCommandSchema = z.discriminatedUnion("type", [
	observabilityFlushCommandSchema,
]);
