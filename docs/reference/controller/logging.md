---
title: "Controller Logging"
---

The controller owns one local logging pipeline. It writes a canonical structured log and, by default, a human-readable text view to the configured logging directory. Configured observability destinations read the canonical log directly by default; they do not create a second archive or spool.

## Configuration

```typescript
export default defineConfig({
  controller: {
    logging: {
      dirname: '.logs',
      text: {
        enabled: true,
        level: 'info',
      },
    },
  },
});
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `dirname` | `string` | `'.logs'` | Logging directory, resolved from the project working directory |
| `text.enabled` | `boolean` | `true` | Write the human-readable `.log` view |
| `text.level` | `'error' \| 'warn' \| 'info' \| 'debug' \| 'verbose'` | `'info'` | Least severe level written to the text view |
| `overrideConsole` | `boolean` | `true` outside tests | Route console methods through the controller logger |
| `maxSize` | `string` | `'8m'` | Legacy-compatible target size for each new segment |
| `maxFiles` | `string` | `'28d'` | A positive day-based value sets maximum age; count-based and non-day values fail configuration validation |
| `format` | Winston `Format` | Built-in text format | Legacy-compatible formatter for the text view only |
| `datePattern` | `string` | `'YYYY-MM-DD'` | Accepted for compatibility; a nondefault value is ignored with one deprecation warning because segment names are owner-managed |

`format` and `text.level` never change the canonical JSONL schema. There are no observability-side directory, maximum-byte, or maximum-age options. The logging owner applies one rotation and retention policy to the files and checkpoints in this directory. `maxSize` must parse as a byte size of at least 1,024 bytes (for example, `8m` or `12mb`); invalid or smaller values fail configuration validation.

The built-in policy rotates by UTC day or when a segment reaches approximately 8 MiB. It bounds retained files to 256 MiB total and, by default, 28 days. Retention is checked before reader enrollment, during rotation and shutdown, and by scheduled maintenance while the source is idle. Expired history is removed before a newly enrolled destination can replay it. `maxSize` and a day-based `maxFiles` value preserve the existing logging configuration surface; the total 256 MiB cap is not configurable through observability.

## Files and format

Canonical segments use names like `launchpad-<sequence>-<id>-<UTC-date>.<active|sealed>.jsonl`. Every complete line is a versioned, normalized JSON record with its original timestamp and resource snapshot. The canonical format is the machine-readable contract used for replay.

When `text.enabled` is true, matching `launchpad-<sequence>-<id>-<UTC-date>.<active|sealed>.log` segments provide a human-readable view. The default level is `info`, so debug and verbose records remain available in canonical JSONL without appearing in text. The text layout is not a stable structured-data format.

The directory also contains source metadata, atomic per-destination checkpoints, and `.launchpad-log.lock`. The lock file is permanent by design: do not delete, rename, replace, or rotate it. The operating system releases the advisory lock when its owning process exits; do not use PID inspection or manual lock-file cleanup to take ownership.

Only one controller process may own a logging directory at a time. This resource-level lock is separate from the controller's project ownership lease: the project lease prevents task and persistent controllers with the same resolved `pidFile` identity from overlapping, while the logging lease independently protects a configured log directory from accidental sharing.

Both leases use `fs-native-extensions` and require a local filesystem. NFS, SMB, and other network filesystems are unsupported and unverified. The logging lock path has been exercised on macOS ARM with Node.js 24; Linux and Windows validation is pending CI.

## Recorded events

The canonical log records ordinary controller logger calls plus a bounded set of operational lifecycle events:

- command and workflow success or error;
- system shutdown or error;
- content fetch/source completion or error, and version promotion; and
- monitor connection completion/error, disconnect completion, and app started, stopped, restarted, error, online, exit, or crash.

Progress events and raw application stdout/stderr are not copied wholesale from the event bus. The logging layer owns normalization, key-based redaction, formatting, rotation, and retention for recorded entries.

## Failure and shutdown behavior

Logger calls enter a bounded admission queue so application work does not wait on filesystem I/O. Disk-full, write, or admission-overflow failures produce logging diagnostics and loss accounting. Launchpad does not silently switch file-backed observability to memory delivery, and a logging failure does not intentionally crash the application.

A failure of the optional text view produces a diagnostic without discarding pending canonical records. Canonical loss counters do not count records that were successfully persisted only because their text view failed.

Shutdown callers wait only for their configured deadline. The logging owner nevertheless keeps the operating-system lease until all file and checkpoint I/O has settled; a caller timing out does not release the lease while I/O remains active. Retention can remove records before a lagging destination reads or acknowledges them; diagnostics report a known loss count where it can be proven and an unknown-size gap otherwise.

See [Observability configuration](../observability/observability-config.md) for default checkpointed file delivery and the explicit memory opt-out.
