import type { LogEventPayload, LogLevel } from "@bluecadet/launchpad-utils/types";

export const isDetached = process.env.LAUNCHPAD_IS_DETACHED === "1";

type ChildLogMessage = { type: "log"; level: LogLevel; payload: Omit<LogEventPayload, "message"> };

let sentReady = false;

export function forwardLog(level: LogLevel, payload: Omit<LogEventPayload, "message">) {
	if (isDetached && process.send && !sentReady) {
		// If detached, send log messages back to parent process via IPC
		process.send?.({ type: "log", level, payload } satisfies ChildLogMessage);
	}
}

type ReadyMessage = { type: "ready" };

export function sendReadyMessage() {
	if (isDetached && process.send && !sentReady) {
		process.send({ type: "ready" } satisfies ReadyMessage);
		sentReady = true;
	}
}

export function isValidChildLogMessage(obj: unknown): obj is ChildLogMessage {
	return typeof obj === "object" && obj !== null && "type" in obj && obj.type === "log";
}

export function isValidReadyMessage(obj: unknown): obj is ReadyMessage {
	return typeof obj === "object" && obj !== null && "type" in obj && obj.type === "ready";
}
