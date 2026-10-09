import { parse } from "protobufjs";
import { vi } from "vitest";
import type { DestinationExporters, ResourceAttributes } from "../core/destination.js";
import type { LogEntry } from "../core/log-entry.js";
import {
	createOtlpDestination,
	type OtlpDestinationConfig,
	type OtlpSignal,
} from "../destinations/otlp.js";

export const RESOURCE: ResourceAttributes = {
	"service.name": "content-api",
	"service.instance.id": "instance-1",
	team: "content",
	region: "us-east-1",
	workers: 4,
	production: true,
};

export const BLUECADET_COMPATIBILITY_RESOURCE: ResourceAttributes = {
	"service.name": "launchpad",
	"launchpad.client": "museum",
	"launchpad.project": "gallery",
	"launchpad.installation": "lobby",
	"deployment.environment.name": "production",
};

export function logEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		timestamp: new Date("2024-06-15T12:00:00.123Z"),
		level: "info",
		message: "server ready",
		event: "log:info",
		module: "server",
		metadata: { port: 8080 },
		...overrides,
	};
}

export function exporters(
	config: Partial<OtlpDestinationConfig> = {},
	resourceAttributes: ResourceAttributes = RESOURCE,
): DestinationExporters {
	const destination = createOtlpDestination({
		endpoint: "https://collector.example/proxy/otlp/",
		...config,
	});
	return destination.create({ resourceAttributes })._unsafeUnwrap();
}

export function okResponse(body = "{}", headers?: Readonly<Record<string, string>>): Response {
	return new Response(body, { status: 200, headers });
}

export function fetchOk(body = "{}"): ReturnType<typeof vi.fn> {
	return vi.fn().mockImplementation(async () => okResponse(body));
}

export function fetchProtobufOk(
	body: Uint8Array<ArrayBuffer> = new Uint8Array(),
): ReturnType<typeof vi.fn> {
	return vi.fn().mockImplementation(async () => new Response(body, { status: 200 }));
}

export type CapturedRequest = {
	readonly url: string;
	readonly init: RequestInit;
};

export function rawRequestFrom(fetchMock: ReturnType<typeof vi.fn>, call = 0): CapturedRequest {
	const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
	return { url, init };
}

export function requestFrom(
	fetchMock: ReturnType<typeof vi.fn>,
	call = 0,
): CapturedRequest & { body: Record<string, unknown> } {
	const request = rawRequestFrom(fetchMock, call);
	return {
		...request,
		body: JSON.parse(String(request.init.body)),
	};
}

export function protobufResponse(
	signal: OtlpSignal,
	partialSuccess?: Readonly<Record<string, unknown>>,
): Uint8Array<ArrayBuffer> {
	const names =
		signal === "logs"
			? {
					response: "ExportLogsServiceResponse",
					partial: "ExportLogsPartialSuccess",
					rejected: "rejected_log_records",
				}
			: {
					response: "ExportMetricsServiceResponse",
					partial: "ExportMetricsPartialSuccess",
					rejected: "rejected_data_points",
				};
	const schema = `
		syntax = "proto3";
		message ${names.response} { ${names.partial} partial_success = 1; }
		message ${names.partial} {
			int64 ${names.rejected} = 1;
			string error_message = 2;
		}
	`;
	const responseType = parse(schema).root.lookupType(names.response);
	const message = responseType.fromObject(partialSuccess === undefined ? {} : { partialSuccess });
	return Uint8Array.from(responseType.encode(message).finish());
}

export function activeContext(): { signal: AbortSignal } {
	return { signal: new AbortController().signal };
}

export function exportedLogRecords(body: Record<string, unknown>): Array<{
	severityNumber: number;
	severityText: string;
}> {
	const payload = body as {
		resourceLogs: Array<{
			scopeLogs: Array<{
				logRecords: Array<{ severityNumber: number; severityText: string }>;
			}>;
		}>;
	};
	return payload.resourceLogs[0]!.scopeLogs[0]!.logRecords;
}

export function exportedResourceAttributes(body: Record<string, unknown>): Array<{
	key: string;
	value: Record<string, unknown>;
}> {
	if ("resourceLogs" in body) {
		const payload = body as {
			resourceLogs: Array<{
				resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
			}>;
		};
		return payload.resourceLogs[0]!.resource.attributes;
	}

	const payload = body as {
		resourceMetrics: Array<{
			resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
		}>;
	};
	return payload.resourceMetrics[0]!.resource.attributes;
}

export function exportedMetrics(body: Record<string, unknown>): Array<{
	gauge: { dataPoints: unknown[] };
}> {
	const payload = body as {
		resourceMetrics: Array<{
			scopeMetrics: Array<{
				metrics: Array<{ gauge: { dataPoints: unknown[] } }>;
			}>;
		}>;
	};
	return payload.resourceMetrics[0]!.scopeMetrics[0]!.metrics;
}
