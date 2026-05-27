import type { ResultAsync } from "neverthrow";
import type { LogEntry } from "./log-entry.js";

/**
 * Interface for observability transports. Implement this to send log entries
 * to any backend (Loki, Datadog, OpenTelemetry, etc.).
 */
export type ObservabilityTransport = {
	/** Unique name used in state tracking and event payloads. */
	readonly name: string;
	/** Push a batch of log entries to the backend. */
	push(batch: LogEntry[]): ResultAsync<void, Error>;
	/** Optional cleanup on shutdown. */
	disconnect?(): ResultAsync<void, Error>;
};
