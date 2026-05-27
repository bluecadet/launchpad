import type { LogEventPayload } from "@bluecadet/launchpad-utils/logger";

export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose" | "event";

/**
 * Normalized log entry that all transports receive.
 * Lifecycle/non-log events get level "event".
 */
export type LogEntry = {
	timestamp: Date;
	level: LogLevel;
	message: string;
	/** Original event name from the event bus, e.g. "log:error", "monitor:app:crash" */
	event: string;
	/** Logger child scope, if present (only on log:* events) */
	module?: string;
	/** Full event payload */
	metadata: Record<string, unknown>;
};

const LOG_LEVELS = new Set(["log:error", "log:warn", "log:info", "log:debug", "log:verbose"]);

/**
 * Converts a raw event bus event into a normalized LogEntry.
 */
export function eventToLogEntry(event: string, data: unknown): LogEntry {
	if (LOG_LEVELS.has(event)) {
		const payload = data as LogEventPayload;
		const level = event.slice("log:".length) as Exclude<LogLevel, "event">;
		return {
			timestamp: new Date(),
			level,
			message: payload.message,
			event,
			module: payload.module,
			metadata: { args: payload.args },
		};
	}

	// Lifecycle / structural event
	const metadata =
		data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
	return {
		timestamp: new Date(),
		level: "event",
		message: event,
		event,
		metadata,
	};
}
