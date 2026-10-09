---
title: "Custom Observability Destinations"
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
  readonly supportsResourceContext?: true;
  export(
    records: readonly LogEntry[],
    context: LogExportContext,
  ): ResultAsync<ExportResult, ExportFailure>;
}

interface LogExportContext extends ExportContext {
  readonly resourceAttributes?: ResourceAttributes;
  readonly recordFormat?: 'canonical';
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

Return `{ rejectedRecords: 0 }` after accepting an entire batch. A nonzero count is a terminal result for the whole batch: Launchpad counts accepted and rejected records, then acknowledges the batch. The protocol does not identify individual rejected records, so Launchpad does not retry them separately.

Map failures to `ExportFailure`:

```typescript
type ExportFailure = Error & {
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
};
```

Set `retryable: false` for a permanent failure. A retryable backend can provide `retryAfterMs` as a hint. Do not throw from `create()`, `export()`, or `shutdown()`; return `Result` or `ResultAsync`.

## File-delivery support

File delivery is the default when `logStorage` is omitted, as well as when `{ type: 'file' }` is explicit. A custom destination with a log exporter must provide both:

- a stable, credential-free `checkpointKey` on the destination; and
- `supportsResourceContext: true` on its log exporter.

The checkpoint identity combines the destination name, checkpoint key, and controller log source. Base the key on the logical target, such as a normalized endpoint. Do not include tokens, passwords, authorization headers, or the destination's complete configuration. Keep it stable across ordinary credential rotation. Change the destination name when two accounts share one endpoint but require separate delivery histories.

During replay, `LogExportContext.resourceAttributes` contains the resource snapshot stored with that batch. A compatible exporter must use it instead of only the setup-time resource from `DestinationContext`. This prevents a restarted process from relabeling historical logs with its new runtime identity. Built-in Loki and OTLP destinations implement both requirements.

The file-delivery runtime also sets `recordFormat: 'canonical'` for trusted, validated central-source records alongside their historical resource snapshot. These records have already been normalized and redacted; exporters may preserve their resource and nested metadata without normalizing them again. This is an exporter context flag, not a user configuration option. Omit it for raw entries: a resource override alone does not make records canonical, and the default export path still normalizes and redacts them.

Custom log exporters without this support must explicitly configure `logStorage: { type: 'memory' }` or implement replay support before upgrading. With explicit memory delivery, `checkpointKey`, `supportsResourceContext`, and the per-call resource remain optional. Metrics-only exporters do not need log replay support.

The default file source contains the controller's canonical records, not every raw custom bus event. Use explicit memory delivery for custom live-bus event capture, test contexts without a canonical source, or ephemeral delivery. There is no automatic memory fallback when the file source is unavailable.

## Design limits

- Keep names, metric attributes, and resource attributes bounded.
- Treat resource attributes and metric-point attributes as separate scopes. Do not copy resource values into every point unless your destination protocol explicitly requires that representation.
- Preserve all resource attributes in destination formats that have a resource scope.
- Export only finite gauge values.
- Do not retain unbounded batches in destination state; Launchpad's own queue is bounded, but it cannot bound a destination's private memory.
- Treat shutdown as best effort and honor its abort signal.
- Avoid adding high-cardinality values such as timestamps, request IDs, file paths, or arbitrary state as metric attributes.
