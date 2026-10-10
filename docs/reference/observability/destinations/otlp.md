---
title: "OTLP/HTTP Destination"
---

`createOtlpDestination()` exports logs and gauges as OTLP/HTTP using native `fetch`. JSON is the default encoding; binary protobuf is available for recipients that support OTLP/HTTP protobuf. It does not require an OpenTelemetry SDK or configure global OpenTelemetry providers.

```typescript
import { createOtlpDestination } from '@bluecadet/launchpad/observability/destinations/otlp';

const endpoint = 'https://collector.example.com/otlp';
const destination = createOtlpDestination({ endpoint, encoding: 'protobuf' });
```

`'protobuf'` selects binary OTLP/HTTP protobuf, not gRPC. Omit `encoding` to preserve the default JSON behavior. The collector or vendor receiving telemetry must support the selected OTLP/HTTP encoding.

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `endpoint` | `string` | Required | HTTP(S) OTLP base URL |
| `encoding` | `'json' \| 'protobuf'` | `'json'` | Request and response body encoding |
| `name` | `string` | `'otlp'` | Destination name used in diagnostics |
| `token` | `string` | — | Bearer token |
| `headers` | `Record<string, string>` | `{}` | Additional request headers |
| `signals` | `('logs' \| 'metrics')[]` | `['logs', 'metrics']` | Exporters to enable |

The factory is inert; options are validated during plugin setup through the destination’s `create()` result. An explicitly supplied `token` must be nonblank. For optional environment variables, use `process.env.LAUNCHPAD_OBSERVABILITY_TOKEN || undefined` to treat an empty value as absent.

At least one signal is required and duplicates are rejected. The endpoint cannot contain credentials, a query, or a fragment. `/v1/logs` and `/v1/metrics` are appended to its path automatically for both encodings. JSON requests and responses use `Content-Type: application/json`; protobuf requests and responses use `Content-Type: application/x-protobuf`. The destination selects both request and response decoding from `encoding`. The managed `Content-Type` and, when `token` is supplied, `Authorization: Bearer …` override headers with those names.

Authentication, batching, resource attributes, partial-success handling, and retries work the same for both encodings. The destination accepts HTTP 200 as OTLP success and reads OTLP partial-success rejection counts. It marks HTTP 429, 502, 503, and 504 as retryable and honors `Retry-After`; other non-200 statuses are permanent failures. Requests still remain bounded by `delivery.deliveryTimeoutMs` and queue limits. Payload compression is not configured by `encoding`.

With default file delivery, the destination derives its credential-free checkpoint key from the normalized endpoint. Token, headers, encoding, and signal selection do not affect that key. Changing only credentials preserves the checkpoint; changing the endpoint enrolls a new reader. If two accounts share one endpoint, change the destination `name` when switching accounts. Replayed OTLP records preserve their stored timestamps and resource snapshots. Confirm that the receiver accepts timestamps as old as the controller's retention window.

Logs use the `@bluecadet/launchpad-observability` instrumentation scope. Metadata is bounded, normalized, and key-redacted before encoding. Every configured resource attribute is encoded in the OTLP resource for both logs and metrics. Metric-point attributes remain a separate scope and are not populated from the resource. Metrics are OTLP gauges. Invalid or non-finite records are rejected rather than sent.

Backends differ in how they expose OTLP resource attributes as queryable labels. Configure resource-to-label mapping in your collector when dashboards or alerts depend on those labels.

This implementation is covered by HTTP payload and response fixture tests. It has not been validated against a live OpenTelemetry Collector in this release environment.
