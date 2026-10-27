---
title: "Custom observability destinations"
---

Implement `ObservabilityDestination` when a backend is not covered by Loki or OTLP.

```typescript
interface ObservabilityDestination {
  readonly name: string;
  readonly checkpointKey?: string;
  readonly create: (
    context: DestinationContext,
  ) => Result<DestinationExporters, ExportFailure>;
}
```

A destination is inert configuration. `create()` receives immutable `context.resourceAttributes`, which holds the caller's optional flat `resource` record plus the runtime defaults for `service.name` and `service.instance.id`. `create()` builds local exporter state and must not make network requests; network work belongs in an export call or `shutdown()`.

## Exporters

`create()` returns the signal exporters it supports:

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
    context: LogExportContext,
  ): ResultAsync<ExportResult, ExportFailure>;
  exportCanonical?(
    batch: CanonicalLogBatch,
    context: ExportContext,
  ): ResultAsync<ExportResult, ExportFailure>;
}

interface CanonicalLogBatch {
  readonly records: readonly NormalizedLogRecord[];
  readonly resourceAttributes: ResourceAttributes;
}

interface LogExportContext extends ExportContext {
  readonly resourceAttributes?: ResourceAttributes;
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

The `AbortSignal` in each `ExportContext` aborts when the delivery deadline expires. Pass it to `fetch` and other cancellable I/O.

Return `{ rejectedRecords: 0 }` after accepting an entire batch. A nonzero count is terminal for the whole batch: Launchpad counts accepted and rejected records, then acknowledges the batch. The protocol does not identify individual rejected records, so Launchpad does not retry them individually.

Map failures to `ExportFailure`:

```typescript
type ExportFailure = Error & {
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
};
```

Set `retryable: false` for a permanent failure. A retryable failure can include `retryAfterMs` as a hint. Do not throw from `create()`, `export()`, or `shutdown()`; return `Result` or `ResultAsync`.

## File-delivery support

File delivery applies when `logStorage` is omitted or set to `{ type: 'file' }`. A custom destination with a log exporter must provide both:

- a stable, credential-free `checkpointKey` on the destination; and
- an `exportCanonical(batch, context)` method on its log exporter.

The checkpoint identity combines the destination name, checkpoint key, and controller log source. Base the key on the logical target, such as a normalized endpoint, and keep it stable across credential rotation. Exclude tokens, passwords, authorization headers, and the destination's complete configuration. When two accounts share one endpoint but need separate delivery histories, give them different destination names.

During replay, Launchpad calls `exportCanonical()` with normalized records and their historical resource snapshot in `batch.resourceAttributes`. Use that snapshot instead of the setup-time resource from `DestinationContext` so a restarted process does not relabel historical logs with its new runtime identity. The built-in Loki and OTLP destinations meet both requirements.

`CanonicalLogBatch.records` contains validated `NormalizedLogRecord` values from the central source. They are already normalized and redacted; preserve their resource and nested metadata without normalizing them again. Raw entries belong in `export()`, whose optional resource override does not make them canonical. Separate entry points let TypeScript check the canonical record shape instead of relying on a context flag to skip redaction.

Custom log exporters without `exportCanonical()` must set `logStorage: { type: 'memory' }` or implement replay support before upgrading. With memory delivery, `checkpointKey`, `exportCanonical()`, and the per-call resource are optional. Metrics-only exporters need no log replay support.

The default file source holds the controller's canonical records, not every raw custom bus event. Use memory delivery for custom live-bus events, test contexts without a canonical source, or ephemeral delivery. An unavailable file source does not fall back to memory.

## Design limits

- Keep names, metric attributes, and resource attributes bounded.
- Treat resource attributes and metric-point attributes as separate scopes. Copy resource values into points only when your protocol requires it.
- Preserve all resource attributes in destination formats that have a resource scope.
- Export only finite gauge values.
- Keep batches retained in destination state bounded; Launchpad bounds its own queue but not a destination's private memory.
- Treat shutdown as best effort and honor its abort signal.
- Keep high-cardinality values such as timestamps, request IDs, file paths, or arbitrary state out of metric attributes.
