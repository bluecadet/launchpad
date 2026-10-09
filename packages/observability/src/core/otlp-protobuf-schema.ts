/*
 * Copyright 2019-2020, OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { INamespace } from "protobufjs";

/**
 * Reachable OTLP logs-and-gauge schema subset used by this package.
 *
 * Derived from opentelemetry-proto v1.9.0 (commit
 * a8951735f7801e8adfaec5c0ace9262771cfec6e):
 * https://github.com/open-telemetry/opentelemetry-proto/tree/v1.9.0/opentelemetry/proto
 *
 * Message namespaces are flattened because protobuf type names are not present
 * on the wire. Field names use protobufjs's camel-case object convention. Field
 * numbers and wire types remain identical to the pinned official definitions.
 * Fields unreachable from the destination's logs and gauge model are omitted.
 */
export const otlpProtobufSchema: INamespace = {
	nested: {
		AnyValue: {
			oneofs: {
				value: {
					oneof: [
						"stringValue",
						"boolValue",
						"intValue",
						"doubleValue",
						"arrayValue",
						"kvlistValue",
					],
				},
			},
			fields: {
				stringValue: { type: "string", id: 1 },
				boolValue: { type: "bool", id: 2 },
				intValue: { type: "int64", id: 3 },
				doubleValue: { type: "double", id: 4 },
				arrayValue: { type: "ArrayValue", id: 5 },
				kvlistValue: { type: "KeyValueList", id: 6 },
			},
		},
		ArrayValue: {
			fields: {
				values: { rule: "repeated", type: "AnyValue", id: 1 },
			},
		},
		KeyValueList: {
			fields: {
				values: { rule: "repeated", type: "KeyValue", id: 1 },
			},
		},
		KeyValue: {
			fields: {
				key: { type: "string", id: 1 },
				value: { type: "AnyValue", id: 2 },
			},
		},
		InstrumentationScope: {
			fields: {
				name: { type: "string", id: 1 },
				version: { type: "string", id: 2 },
				attributes: { rule: "repeated", type: "KeyValue", id: 3 },
				droppedAttributesCount: { type: "uint32", id: 4 },
			},
		},
		Resource: {
			fields: {
				attributes: { rule: "repeated", type: "KeyValue", id: 1 },
				droppedAttributesCount: { type: "uint32", id: 2 },
			},
		},
		SeverityNumber: {
			values: {
				SEVERITY_NUMBER_UNSPECIFIED: 0,
				SEVERITY_NUMBER_TRACE: 1,
				SEVERITY_NUMBER_TRACE2: 2,
				SEVERITY_NUMBER_TRACE3: 3,
				SEVERITY_NUMBER_TRACE4: 4,
				SEVERITY_NUMBER_DEBUG: 5,
				SEVERITY_NUMBER_DEBUG2: 6,
				SEVERITY_NUMBER_DEBUG3: 7,
				SEVERITY_NUMBER_DEBUG4: 8,
				SEVERITY_NUMBER_INFO: 9,
				SEVERITY_NUMBER_INFO2: 10,
				SEVERITY_NUMBER_INFO3: 11,
				SEVERITY_NUMBER_INFO4: 12,
				SEVERITY_NUMBER_WARN: 13,
				SEVERITY_NUMBER_WARN2: 14,
				SEVERITY_NUMBER_WARN3: 15,
				SEVERITY_NUMBER_WARN4: 16,
				SEVERITY_NUMBER_ERROR: 17,
				SEVERITY_NUMBER_ERROR2: 18,
				SEVERITY_NUMBER_ERROR3: 19,
				SEVERITY_NUMBER_ERROR4: 20,
				SEVERITY_NUMBER_FATAL: 21,
				SEVERITY_NUMBER_FATAL2: 22,
				SEVERITY_NUMBER_FATAL3: 23,
				SEVERITY_NUMBER_FATAL4: 24,
			},
		},
		LogRecord: {
			fields: {
				timeUnixNano: { type: "fixed64", id: 1 },
				severityNumber: { type: "SeverityNumber", id: 2 },
				severityText: { type: "string", id: 3 },
				body: { type: "AnyValue", id: 5 },
				attributes: { rule: "repeated", type: "KeyValue", id: 6 },
			},
		},
		ScopeLogs: {
			fields: {
				scope: { type: "InstrumentationScope", id: 1 },
				logRecords: { rule: "repeated", type: "LogRecord", id: 2 },
				schemaUrl: { type: "string", id: 3 },
			},
		},
		ResourceLogs: {
			fields: {
				resource: { type: "Resource", id: 1 },
				scopeLogs: { rule: "repeated", type: "ScopeLogs", id: 2 },
				schemaUrl: { type: "string", id: 3 },
			},
		},
		ExportLogsServiceRequest: {
			fields: {
				resourceLogs: { rule: "repeated", type: "ResourceLogs", id: 1 },
			},
		},
		NumberDataPoint: {
			oneofs: {
				value: { oneof: ["asDouble"] },
			},
			fields: {
				startTimeUnixNano: { type: "fixed64", id: 2 },
				timeUnixNano: { type: "fixed64", id: 3 },
				asDouble: { type: "double", id: 4 },
				attributes: { rule: "repeated", type: "KeyValue", id: 7 },
			},
		},
		Gauge: {
			fields: {
				dataPoints: { rule: "repeated", type: "NumberDataPoint", id: 1 },
			},
		},
		Metric: {
			oneofs: {
				data: { oneof: ["gauge"] },
			},
			fields: {
				name: { type: "string", id: 1 },
				description: { type: "string", id: 2 },
				unit: { type: "string", id: 3 },
				gauge: { type: "Gauge", id: 5 },
			},
		},
		ScopeMetrics: {
			fields: {
				scope: { type: "InstrumentationScope", id: 1 },
				metrics: { rule: "repeated", type: "Metric", id: 2 },
				schemaUrl: { type: "string", id: 3 },
			},
		},
		ResourceMetrics: {
			fields: {
				resource: { type: "Resource", id: 1 },
				scopeMetrics: { rule: "repeated", type: "ScopeMetrics", id: 2 },
				schemaUrl: { type: "string", id: 3 },
			},
		},
		ExportMetricsServiceRequest: {
			fields: {
				resourceMetrics: { rule: "repeated", type: "ResourceMetrics", id: 1 },
			},
		},
		ExportLogsPartialSuccess: {
			fields: {
				rejectedLogRecords: { type: "int64", id: 1 },
				errorMessage: { type: "string", id: 2 },
			},
		},
		ExportLogsServiceResponse: {
			fields: {
				partialSuccess: { type: "ExportLogsPartialSuccess", id: 1 },
			},
		},
		ExportMetricsPartialSuccess: {
			fields: {
				rejectedDataPoints: { type: "int64", id: 1 },
				errorMessage: { type: "string", id: 2 },
			},
		},
		ExportMetricsServiceResponse: {
			fields: {
				partialSuccess: { type: "ExportMetricsPartialSuccess", id: 1 },
			},
		},
	},
};
