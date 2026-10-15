import { launchpadConfigSchema } from "@bluecadet/launchpad-cli";
import { contentConfigSchema } from "@bluecadet/launchpad-content/config";
import { controllerConfigSchema, logConfigSchema } from "@bluecadet/launchpad-controller/config";
import { monitorConfigSchema } from "@bluecadet/launchpad-monitor/config";
import {
	destinationObservabilityConfigSchema,
	legacyObservabilityConfigSchema,
} from "@bluecadet/launchpad-observability/config";
import { scheduleSpecSchema } from "@bluecadet/launchpad-scheduler/config";
import type { z } from "zod";

/** Runtime schemas used by the shared configuration reference component. */
export const configReferences: {
	id: string;
	schema: z.ZodType;
	nested?: boolean;
}[] = [
	{
		id: "content-options",
		schema: contentConfigSchema,
	},
	{
		id: "monitor-options",
		schema: monitorConfigSchema,
	},
	{
		id: "scheduler-options",
		schema: scheduleSpecSchema,
	},
	{
		id: "observability-destination-options",
		schema: destinationObservabilityConfigSchema,
	},
	{
		id: "observability-legacy-options",
		schema: legacyObservabilityConfigSchema,
	},
	{
		id: "controller-logging-options",
		schema: logConfigSchema,
	},
	{
		id: "controller-options",
		schema: controllerConfigSchema,
		nested: false,
	},
	{
		id: "launchpad-options",
		schema: launchpadConfigSchema,
		nested: false,
	},
];
