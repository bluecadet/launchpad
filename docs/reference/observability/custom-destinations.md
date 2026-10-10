---
title: "Custom Observability Destinations"
---

Implement `ObservabilityDestination` when a backend is not covered by Loki or OTLP.

```typescript
interface ObservabilityDestination {
  readonly name: string;
  readonly create: (
    context: DestinationContext,
  ) => Result<DestinationExporters, ExportFailure>;
}
```

A destination is inert configuration. `create()` receives immutable `context.resourceAttributes` and builds local exporter state. The context contains the caller's optional flat `resource` record plus the runtime defaults for `service.name` and `service.instance.id`. It must not make network requests. Network work belongs in an export call or `shutdown()`.

## Exporters

`create()` returns any supported signal exporters:

```typescript
interface DestinationExporters {
  readonly logs?: LogExporter;
  readonly metrics?: MetricExporter;
  readonly shutdown?: (
    context: ExportContext,
  ) => ResultAsync<void, ExportFailure>;
}

interface LogExporter {
  export(
    records: readonly LogEntry[],
    context: ExportContext,
  ): ResultAsync<ExportResult, ExportFailure>;
}

interface MetricExporter {
  export(
    batch: {
      timestamp: Date;
      observations: readonly MetricObservation[];
    },
    context: ExportContext,
  ): ResultAsync<ExportResult, ExportFailure>;
}
```

The `AbortSignal` in each `ExportContext` is cancelled when the configured delivery deadline expires. Pass it to `fetch` and any other cancellable I/O.

Return `{ rejectedRecords: 0 }` after accepting an entire batch. A nonzero count is a terminal rejection of that many records; accepted records must not be retried.

Map failures to `ExportFailure`:

```typescript
type ExportFailure = Error & {
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
};
```

Set `retryable: false` for a permanent failure. A retryable backend can provide `retryAfterMs` as a hint. Do not throw from `create()`, `export()`, or `shutdown()`; return `Result` or `ResultAsync`.

## Design limits

- Keep names, metric attributes, and resource attributes bounded.
- Treat resource attributes and metric-point attributes as separate scopes. Do not copy resource values into every point unless your destination protocol explicitly requires that representation.
- Preserve all resource attributes in destination formats that have a resource scope.
- Export only finite gauge values.
- Do not retain unbounded batches in destination state; Launchpad's own queue is bounded, but it cannot bound a destination's private memory.
- Treat shutdown as best effort and honor its abort signal.
- Avoid adding high-cardinality values such as timestamps, request IDs, file paths, or arbitrary state as metric attributes.
