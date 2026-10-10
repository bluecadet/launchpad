import {
	createStructuredLog as createSharedStructuredLog,
	DEFAULT_MAX_STRUCTURED_LOG_LENGTH,
	type LogEntry,
	type ResourceAttributes,
	type StructuredLog,
	type StructuredNormalizationOptions,
	serializeStructuredLog as serializeSharedStructuredLog,
} from "@bluecadet/launchpad-utils/logging";
import type { Result } from "neverthrow";
import type { ExportFailure } from "./destination.js";
import { DestinationFailure } from "./export-failure.js";

export type {
	StructuredLog,
	StructuredNormalizationOptions,
	StructuredValue,
} from "@bluecadet/launchpad-utils/logging";
export {
	CIRCULAR_VALUE,
	DEFAULT_MAX_STRUCTURED_LOG_LENGTH,
	GETTER_VALUE,
	normalizeStructuredValue,
	REDACTED_VALUE,
	TRUNCATED_VALUE,
	UNREADABLE_VALUE,
} from "@bluecadet/launchpad-utils/logging";

/** Build a shared structured log with destination-safe failure diagnostics. */
export function createStructuredLog(
	entry: LogEntry,
	resourceAttributes: ResourceAttributes,
	options: Partial<StructuredNormalizationOptions> = {},
): Result<StructuredLog, ExportFailure> {
	return createSharedStructuredLog(entry, resourceAttributes, options).mapErr(
		(error) => new DestinationFailure(error.message, { retryable: false }),
	);
}

/** Serialize a shared structured log with destination-safe failure diagnostics. */
export function serializeStructuredLog(
	log: StructuredLog,
	maxLength = DEFAULT_MAX_STRUCTURED_LOG_LENGTH,
): Result<string, ExportFailure> {
	return serializeSharedStructuredLog(log, maxLength).mapErr(
		(error) => new DestinationFailure(error.message, { retryable: false }),
	);
}
