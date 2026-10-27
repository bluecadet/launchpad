---
title: "OTLP/HTTP destination"
---

`createOtlpDestination()` exports logs and gauges as OTLP/HTTP using native `fetch`. JSON is the default encoding; binary protobuf is available for recipients that support it. The destination needs no OpenTelemetry SDK and configures no global OpenTelemetry providers.

```typescript
import { createOtlpDestination } from '@bluecadet/launchpad/observability/destinations/otlp';

const endpoint = 'https://collector.example.com/otlp';
const destination = createOtlpDestination({ endpoint, encoding: 'protobuf' });
```

`'protobuf'` selects binary OTLP/HTTP protobuf, not gRPC. Omit `encoding` for JSON. The receiving collector or vendor must support the selected encoding.

The factory returns an inert destination definition. The observability plugin validates options when it calls `destination.create()` during setup; invalid options return a non-retryable `Err` instead of throwing while your config module loads. Neither the factory nor `create()` sends requests. If you call `create()` directly, handle its `Result`.

A supplied `token` must be nonblank. When reading it from an optional environment variable, map missing or whitespace-only values to `undefined` and pass other values through unchanged: `token: token?.trim() ? token : undefined`. The generated Launchpad config already does this.

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `endpoint` | `string` | Required | HTTP(S) OTLP base URL |
| `encoding` | `'json' \| 'protobuf'` | `'json'` | Request and response body encoding |
| `name` | `string` | `'otlp'` | Destination name used in diagnostics |
| `token` | `string` | — | Bearer token |
| `headers` | `Record<string, string>` | `{}` | Additional request headers |
| `signals` | `('logs' \| 'metrics')[]` | `['logs', 'metrics']` | Exporters to enable |

At least one signal is required, and duplicates are rejected. The endpoint cannot contain credentials, a query, or a fragment. `/v1/logs` and `/v1/metrics` are appended to its path for both encodings. JSON requests and responses use `Content-Type: application/json`; protobuf requests and responses use `Content-Type: application/x-protobuf`. `encoding` sets both request encoding and response decoding. The managed `Content-Type` and, when `token` is supplied, `Authorization: Bearer ...` override custom headers with those names.

Authentication, batching, resource attributes, partial-success handling, and retries work the same for both encodings. The destination treats HTTP 200 as success and reads OTLP partial-success rejection counts. HTTP 429, 502, 503, and 504 are retryable, and the destination honors `Retry-After`; other non-200 statuses are permanent failures. Non-200 response bodies are cancelled without waiting for them to finish streaming. `delivery.deliveryTimeoutMs` and queue limits bound every request. `encoding` does not configure payload compression.

With default file delivery, the destination derives its credential-free checkpoint key from the normalized endpoint. Token, headers, encoding, and signal selection do not affect the key. Changing only credentials preserves the checkpoint; changing the endpoint starts a new reader. If two accounts share one endpoint, change the destination `name` when switching accounts. Replayed records keep their stored timestamps and resource snapshots; confirm that the receiver accepts timestamps as old as the controller's retention window.

Logs use the `@bluecadet/launchpad-observability` instrumentation scope. Metadata is bounded, normalized, and key-redacted before encoding. Every configured resource attribute is encoded in the OTLP resource for both logs and metrics. Metric-point attributes are a separate scope and are not populated from the resource. Metrics are OTLP gauges. Invalid or non-finite records are rejected, not sent.

Backends differ in how they expose OTLP resource attributes as queryable labels. If dashboards or alerts depend on those labels, configure resource-to-label mapping in your collector.

HTTP payload and response fixture tests cover this implementation. It has not been validated against a live OpenTelemetry Collector.
