---
"@bluecadet/launchpad": major
---

Reuse content work and replay retained logs

<!-- changeset: overview -->

Content runs can now reuse downloads and generated files, while observability destinations can resume retained log delivery after a restart. This update also adds current-state gauges, shared progress reporting, and Windows binaries that don't need a native build during installation. Upgrading requires a supported Node.js version and some configuration/API changes below.

#### Skip repeated downloads and transforms

HTTP media downloads, supported Sharp transforms, and custom `ContentTransformContext.cache.derive()` recipes share one artifact cache. SQLite stores metadata; reusable files stay in the published output tree. Existing files without trusted metadata are misses, so the first run after upgrading may download or generate them again.

HTTP reuse follows server policy: an explicit freshness lifetime can avoid a request; stale entries use conditional GET with server-provided `ETag` or `Last-Modified` validators when available. Without explicit freshness, the downloader contacts the server each run. `no-store`, `no-cache`, and `Vary` constrain reuse. Stale reuse after a network/server error requires an applicable `stale-if-error` allowance, not a general offline fallback. Missing or corrupt local files still need a full response.

Sharp automatically fingerprints supported recipes' input bytes, resolved options, dependencies, and engine versions. Optional `cacheKey` adds identity but can't make unsupported recipes cacheable. Custom recipes declare their own revisions, inputs, options, and relative outputs, including external tool versions that affect results. Filenames are unchanged; different identities claiming one output path are errors.

To invalidate metadata without deleting published files, use a started controller with the content plugin registered:

```typescript
const result = await controller.executeCommand({
  type: 'content.clear',
  downloads: false,
  cache: true,
});
if (result.isErr()) throw result.error;
```

Add `sources: ['videos']` to limit clearing to a configured source. Clearing downloads also invalidates selected sources' metadata; temporary-file cleanup doesn't. Clear between fetch runs, not inside generation callbacks.

Cache failures fall back to uncached work only when stale metadata can be safely invalidated or isolated; otherwise publication fails. Don't edit the database or remove lease files to force a refresh.

#### Resume log delivery after restarts

The controller writes canonical JSONL segments plus an optional, default-on human-readable text view. Configured destinations read retained JSONL by default, preserving original timestamps and resource snapshots. Each destination has a checkpoint: restarting with the same destination identity and controller source resumes from that position. The controller owns directory and retention policy.

New destinations start at the oldest retained record. Backfill can increase ingestion costs or encounter backend timestamp rejection. Retention can expire unread records, and lost acknowledgements can cause duplicate replay. Disk failures, backend rejection, and forced exits also limit delivery: it isn't lossless or exactly once. An unavailable file source doesn't silently fall back to memory.

For ephemeral delivery or custom exporters without replay support, opt out explicitly:

```typescript
observability({
  destinations: [destination],
  logStorage: { type: 'memory' },
});
```

Memory delivery has bounded queues and no replay; it doesn't disable local logging. It's also the option for custom live-bus events absent from canonical logs.

Remote export remains optional and endpoint-gated in generated projects. Choose OTLP/HTTP JSON or protobuf for logs and gauges; Loki remains logs-only. Resource attributes are optional. `metrics: false` disables gauges; otherwise they remain latest, coalesced in-memory observations, not replayed history. There's no default Bluecadet telemetry endpoint or hosted dashboard. Review sensitive log data before export: key-based redaction can't catch every secret.

#### Other improvements

- `ContentProgressLogger` brings the downloader and Sharp's completed-task reporting to custom transforms, with or without cache reuse.
- Task and persistent controllers can't overlap for the same configured project identity. PID-file daemon discovery remains; separate leases protect log storage and content publishing. Leases require local filesystems, not NFS or SMB. Don't remove lease files to take ownership. The shared API is exported at `@bluecadet/launchpad-utils/native-file-lease`.
- Windows window management ships x64 and cross-compiled arm64 binaries instead of building native dependencies during installation. Arm64 runtime behavior isn't yet verified. Window flags, debounce settings, and PM2 behavior are unchanged.

#### Before upgrading

- **Node.js:** Use 24.x or 26 and later (`^24 || >=26`) for runtime packages and the scaffolder; caching requires built-in `node:sqlite`. Node.js 23 and 25 are unsupported. Generated projects declare the range, but updates preserve existing declarations: check yours.
- **Downloader:** Remove rejected `enableIfModifiedSinceCheck` and `enableContentLengthCheck` options. Exported `checkCacheStatus` and `downloadFile` helpers are removed. Use `ignoreCache: true` for unconditional downloads; `forceClearTempFiles` clears staging only.
- **Custom transforms:** Manually constructed `ContentTransformContext` values must include `cache`.
- **Logging:** Replace count-based `logging.maxFiles` with age-based retention such as `'28d'`. Resolved `logging.maxSize` and `logging.maxFiles` are numeric bytes and milliseconds, respectively. Update tailing, backup, and cleanup rules: JSONL and optional `.log` segments replace `launchpad-info`, `launchpad-debug`, and `launchpad-error`. Existing files aren't migrated or deleted.
- **Exporters:** Provide a stable, credential-free `checkpointKey` and `exportCanonical(batch, context)` handling normalized records and historical resource snapshots, or explicitly select memory delivery. Legacy `transports` remain in memory and reject either `logStorage` value. Don't mix transport and destination configuration.
- **Observability types:** Stop mutating readonly `LogEntry` fields. `ObservabilityConfig` is a union: narrow it before accessing `transports`, which isn't present in destination mode. These changes also apply through umbrella exports.
