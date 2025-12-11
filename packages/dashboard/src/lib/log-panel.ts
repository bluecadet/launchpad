import { createRequire } from "node:module";
import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import { Handlebars, loadHandlebarsTemplate } from "@bluecadet/launchpad-utils/handlebars";
import type { LogEventPayload } from "@bluecadet/launchpad-utils/logger";
import type { DashboardRegistry } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { createEventStream, getQuery } from "h3";
import { okAsync, type ResultAsync } from "neverthrow";

const require = createRequire(import.meta.url);

type HandlerStream = {
	eventStream: ReturnType<typeof createEventStream>;
	filters: {
		query: string;
		levels: Set<string>;
	};
};

function payloadMatchesFilters(
	payload: LogEventPayload,
	filters: HandlerStream["filters"],
): boolean {
	const { query, levels } = filters;

	const matchesQuery =
		!query ||
		payload.message.toLowerCase().includes(query.toLowerCase()) ||
		payload.module?.toLowerCase().includes(query.toLowerCase());
	const matchesLevel = levels.size === 0 || levels.has(payload.level);
	return !!(matchesQuery && matchesLevel);
}

export function registerLogPanelFeatures(
	registry: DashboardRegistry,
	eventBus: EventBus,
): ResultAsync<void, Error> {
	return loadHandlebarsTemplate<LogEventPayload>(require.resolve("../../static/log-row.hbs"))
		.andTee((logRowTemplate) => {
			Handlebars.registerPartial("logRow", logRowTemplate);
		})
		.andThen((logRowTemplate) => {
			return loadHandlebarsTemplate<{
				logs: LogEventPayload[];
				queryParams?: string;
			}>(require.resolve("../../static/log-panel.hbs")).map((logPanelTemplate) => ({
				logRowTemplate,
				logPanelTemplate,
			}));
		})
		.andThen(({ logRowTemplate, logPanelTemplate }) => {
			// Keep a buffer of the latest log messages
			const logBuffer: LogEventPayload[] = [];
			const MAX_LOG_ENTRIES = 1000;
			const handlers = new Set<HandlerStream>();

			function addLogToBuffer(log: LogEventPayload) {
				logBuffer.push(log);
				if (logBuffer.length > MAX_LOG_ENTRIES) {
					logBuffer.shift(); // Remove oldest log entry
				}

				// Notify all connected clients of the new log entry
				const logMessage = logRowTemplate(log);
				for (const handler of handlers) {
					if (payloadMatchesFilters(log, handler.filters)) {
						handler.eventStream.push(logMessage.replace(/\n/g, "")); // remove newlines, which will terminate the SSE message early
					}
				}
			}

			function filterLogs(
				query: string,
				levelFilters: Set<string> = new Set(["info", "warn", "error", "warn"]),
			): LogEventPayload[] {
				return logBuffer.filter((payload) =>
					payloadMatchesFilters(payload, { query, levels: levelFilters }),
				);
			}

			eventBus.on("log:error", addLogToBuffer);
			eventBus.on("log:warn", addLogToBuffer);
			eventBus.on("log:info", addLogToBuffer);
			eventBus.on("log:debug", addLogToBuffer);
			eventBus.on("log:verbose", addLogToBuffer);

			registry.api.get("/api/log-stream", (event) => {
				const queryParams = getQuery(event);

				const levels = queryParams.levels ? (queryParams.levels as string).split(",") : [];
				const levelSet = new Set<string>(levels);
				const queryString = queryParams.query ? (queryParams.query as string) : "";

				const eventStream = createEventStream(event);

				const handlerStream: HandlerStream = {
					eventStream,
					filters: { query: queryString, levels: levelSet },
				};
				handlers.add(handlerStream);

				eventStream.onClosed(() => {
					handlers.delete(handlerStream);
				});

				return eventStream.send();
			});

			registry.api.get("/api/log-filter", (event) => {
				const queryParams = getQuery(event);

				const levelFilters = new Set<string>();

				if (queryParams["level.debug"]) levelFilters.add("debug");
				if (queryParams["level.info"]) levelFilters.add("info");
				if (queryParams["level.warn"]) levelFilters.add("warn");
				if (queryParams["level.error"]) levelFilters.add("error");
				if (queryParams["level.verbose"]) levelFilters.add("verbose");

				const filteredLogs = filterLogs(queryParams.query ?? "", levelFilters);
				const newQueryParams = `?query=${encodeURIComponent((queryParams.query as string) ?? "")}&levels=${Array.from(levelFilters).join(",")}`;
				return logPanelTemplate({ logs: filteredLogs, queryParams: newQueryParams });
			});

			registry.registerCSS(require.resolve("../../static/log-panel.css"));
			registry.registerJS(require.resolve("../../static/auto-scroll.js"));

			registry.registerPanel({
				title: "Logs",
				render: () =>
					logPanelTemplate({ logs: filterLogs(""), queryParams: "?levels=info,warn,error" }),
			});

			return okAsync();
		});
}
