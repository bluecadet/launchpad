import type { NormalizedLogRecord, ResourceAttributes } from "@bluecadet/launchpad-utils/logging";
import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import type { Result, ResultAsync } from "neverthrow";
import type { LogEntry } from "./log-entry.js";

export type {
	ResourceAttributes,
	ResourceAttributeValue,
} from "@bluecadet/launchpad-utils/logging";

/** Immutable setup context shared by every configured destination. */
export interface DestinationContext {
	readonly resourceAttributes: ResourceAttributes;
}

/** Per-call cancellation context for signal export and shutdown. */
export interface ExportContext {
	readonly signal: AbortSignal;
}

/** Per-call log context, optionally restoring a record's original resource. */
export interface LogExportContext extends ExportContext {
	readonly resourceAttributes?: ResourceAttributes;
}

/**
 * Export outcome. A nonzero count is a terminal rejection of those records;
 * accepted records must not be retried.
 */
export interface ExportResult {
	readonly rejectedRecords: number;
}

/** Export errors may tell the delivery loop whether and when to retry. */
export type ExportFailure = Error & {
	readonly retryable?: boolean;
	readonly retryAfterMs?: number;
};

/** A timestamped batch of gauge observations. */
export interface MetricBatch {
	readonly timestamp: Date;
	readonly observations: readonly MetricObservation[];
}

/**
 * Canonical records grouped by their already-normalized historical resource.
 * Every record must belong to this resource snapshot. Callers must not mutate
 * the records or resource during export.
 */
export interface CanonicalLogBatch {
	readonly records: readonly NormalizedLogRecord[];
	readonly resourceAttributes: ResourceAttributes;
}

/** Raw log export with an optional typed canonical replay capability. */
export interface LogExporter {
	export(
		records: readonly LogEntry[],
		context: LogExportContext,
	): ResultAsync<ExportResult, ExportFailure>;
	/** Presence enables file-backed replay without normalizing canonical metadata again. */
	exportCanonical?(
		batch: CanonicalLogBatch,
		context: ExportContext,
	): ResultAsync<ExportResult, ExportFailure>;
}

export interface MetricExporter {
	export(batch: MetricBatch, context: ExportContext): ResultAsync<ExportResult, ExportFailure>;
}

/** Signal-specific exporters created by one destination. */
export interface DestinationExporters {
	readonly logs?: LogExporter;
	readonly metrics?: MetricExporter;
	readonly shutdown?: (context: ExportContext) => ResultAsync<void, ExportFailure>;
}

/**
 * Destination configuration is inert. create() must only build local exporter
 * state; network activity belongs in export() or shutdown().
 */
export interface ObservabilityDestination {
	readonly name: string;
	readonly checkpointKey?: string;
	readonly create: (context: DestinationContext) => Result<DestinationExporters, ExportFailure>;
}
