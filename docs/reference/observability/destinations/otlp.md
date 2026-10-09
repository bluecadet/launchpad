---
title: "OTLP/HTTP Destination"
---

`createOtlpDestination()` exports logs and gauges as OTLP JSON using native `fetch`. It does not require an OpenTelemetry SDK.

```typescript
import { createOtlpDestination } from '@bluecadet/launchpad/observability/destinations/otlp';

const destination = createOtlpDestination({
  endpoint: 'https://collector.example.com/otlp',
  name: 'operations-collector',
  token: process.env.OTLP_TOKEN,
  headers: { 'X-Tenant': 'museum' },
  signals: ['logs', 'metrics'],
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `endpoint` | `string` | Required | HTTP(S) OTLP base URL |
| `name` | `string` | `'otlp'` | Destination name used in diagnostics |
| `token` | `string` | — | Bearer token |
| `headers` | `Record<string, string>` | `{}` | Additional request headers |
| `signals` | `('logs' \| 'metrics')[]` | `['logs', 'metrics']` | Exporters to enable |

At least one signal is required and duplicates are rejected. The endpoint cannot contain credentials, a query, or a fragment. `/v1/logs` and `/v1/metrics` are appended to its path automatically. `Content-Type: application/json` and, when `token` is supplied, `Authorization: Bearer …` override headers with those names.

The destination accepts HTTP 200 as OTLP success and reads OTLP partial-success rejection counts. It marks HTTP 429, 502, 503, and 504 as retryable and honors `Retry-After`; other non-200 statuses are permanent failures. Requests still remain bounded by `delivery.deliveryTimeoutMs` and queue limits.

Logs use the `@bluecadet/launchpad-observability` instrumentation scope. Metadata is bounded, normalized, and key-redacted before encoding. Every configured resource attribute is encoded in the OTLP resource for both logs and metrics. Metric-point attributes remain a separate scope and are not populated from the resource. Metrics are OTLP gauges. Invalid or non-finite records are rejected rather than sent.

Backends differ in how they expose OTLP resource attributes as queryable labels. Configure resource-to-label mapping in your collector when dashboards or alerts depend on those labels.

This implementation is covered by HTTP payload and response fixture tests. It has not been validated against a live OpenTelemetry Collector in this release environment.
