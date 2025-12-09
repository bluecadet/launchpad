import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { LogEventPayload } from "@bluecadet/launchpad-utils/logger";
import type { DashboardRegistry } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { createEventStream } from "h3";

function renderLogItem(log: LogEventPayload) {
	return `<pre>[${log.timestamp}] [${log.level}] ${log.message}</pre>`;
}

function renderLogPanel(logs: LogEventPayload[]) {
	return `<div id="logs">${logs.map(renderLogItem).join("\n")}</div>`;
}

export function registerLogPanelFeatures(registry: DashboardRegistry, eventBus: EventBus) {
	// Keep a buffer of the latest log messages
	const logBuffer: LogEventPayload[] = [];
	const MAX_LOG_ENTRIES = 1000;
	const handlers = new Set<ReturnType<typeof createEventStream>>();

	function addLogToBuffer(log: LogEventPayload) {
		logBuffer.push(log);
		if (logBuffer.length > MAX_LOG_ENTRIES) {
			logBuffer.shift(); // Remove oldest log entry
		}

		// Notify all connected clients of the new log entry
		const logMessage = renderLogItem(log);
		for (const handler of handlers) {
			handler.push(logMessage);
		}
	}

	eventBus.on("log:error", addLogToBuffer);
	eventBus.on("log:warn", addLogToBuffer);
	eventBus.on("log:info", addLogToBuffer);
	eventBus.on("log:debug", addLogToBuffer);
	eventBus.on("log:verbose", addLogToBuffer);

	registry.api.get("/api/log-stream", (event) => {
		const eventStream = createEventStream(event);
		handlers.add(eventStream);

		eventStream.onClosed(() => {
			handlers.delete(eventStream);
		});

		return eventStream.send();
	});

	registry.registerPanel({
		title: "Logs",
		render: () =>
			`<div hx-ext="sse" hx-target="#logs" hx-swap="beforeend" sse-connect="/api/log-stream" sse-swap="message">${renderLogPanel(logBuffer)}</div>`,
	});
}
