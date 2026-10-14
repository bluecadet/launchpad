---
title: "Content Versioning"
---
Versioning publishes each successful fetch as a new, immutable content version. It is opt-in: without it, content continues to use the normal flat `downloadPath` layout.

For the consumer contract, including how an application discovers and reads a version, see [Version Manifest](./version-manifest.md).

## Configuration

Set `versioning` on the content plugin:

```typescript
content({
  versioning: true,
});
```

`true` uses the defaults. To change retention or ack-lease lifetime, provide an object:

```typescript
content({
  versioning: {
    keepVersions: 5,
    ackTimeout: "1h",
  },
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `versioning` | `boolean \| { keepVersions?: number; ackTimeout?: string \| number }` | `false` | Enables versioned output. |
| `keepVersions` | `number` | `3` | Number of newest version directories to retain. The active version and versions named by fresh ack leases are retained in addition to this count. |
| `ackTimeout` | `string \| number` | `"30m"` | How long an ack lease remains fresh. Duration strings such as `"30s"`, `"5m"`, and `"2h"` are accepted, as are milliseconds. |

## Publishing a version

A successful fetch moves its complete staged output into `versions/<versionId>/` under `downloadPath`. Launchpad then atomically replaces `manifest.json` to point at that directory. The manifest replacement is the commit point: until it succeeds, applications continue to use the previously active version.

Versions are immutable once promoted. A failed promotion can leave an unreferenced directory behind; it is an orphan, not an active version.

`backupAndRestore` is silently superseded while versioning is enabled. Retained version directories provide recovery, and the active version is not modified during a fetch.

### Subset fetches are not supported

A `content.fetch` command that names a subset of sources is rejected while versioning is enabled. Promotion moves the entire staged output into a new version and rebuilds the manifest from the sources that were fetched, so a subset fetch would publish a version missing every source it skipped. Fetch all sources, or disable versioning if you need per-source fetches. Subset fetches remain supported in the flat output mode.

## Retention and cleanup

After every successful versioned fetch, Launchpad calculates the retention set and tries to delete every other directory in `versions/`. The set contains:

- the `keepVersions` newest version directories by version id;
- the version named by the current manifest; and
- any version named by a fresh consumer ack lease.

Deletion is best-effort. A locked directory, including one partially deleted on Windows, stays eligible and is retried after the next successful versioned fetch. Orphans use the same rule and age out normally; they receive no special treatment.

Fresh ack leases only extend retention. They do not make a version permanent: once a lease exceeds `ackTimeout`, it is ignored by the sweep. See [acknowledging a version](./version-manifest.md#acknowledging-a-version) for the consumer-side protocol.

## Failure and clear behavior

A failure before publication leaves the published content untouched. After a version's manifest is replaced, a later cleanup failure does not remove that active version. Cache metadata remains unsafe until a subsequent successful fetch settles it.

In flat mode, with `backupAndRestore` enabled, a publication or temporary-file cleanup failure can restore the previous source files. Launchpad prepares the restore in the run directory before replacing published files. If recovery fails, it retains the run files and backups for manual recovery. Once backup deletion begins, those backups are no longer eligible for rollback: a deletion failure reports an error but leaves the complete newly published files in place.

`content.clear` resolves and validates all requested deletion targets before changing files or cache metadata. Download clearing and versioned seeding also reject manifest source roots that overlap on the actual filesystem, including case aliases on case-insensitive volumes. A clear with `downloads: false` does not read the active manifest, so cache-only, temporary-file, and backup clears still work when that manifest is invalid.

A source-filtered temporary clear removes source leaves in the run layout and the currently configured transforms' temporary namespaces. Source names matching `runs`, `downloads`, or a transform name do not authorize deletion of the containing namespace. Unknown historical transform namespaces are preserved. A direct temporary source directory with subdirectories is ambiguous without a layout record, so a filtered clear refuses it rather than risk deleting another source's files. Use an all-source temporary clear to remove these historical or ambiguous files:

```typescript
await controller.dispatchCommand({
  type: "content.clear",
  downloads: false,
  temp: true,
});
```

This preserves published downloads and artifact metadata. Copy any files retained for manual recovery elsewhere before clearing their temporary or backup directories.

## Switching modes

Versioned and normal output modes do not migrate or clean up one another's artifacts. Turning versioning on leaves existing flat output alone; turning it off leaves `manifest.json`, `versions/`, and `acks/` alone. Artifacts from the inactive mode are inert.

Remove inactive-mode artifacts manually only after confirming that no application still relies on them.

## Status

When versioning is enabled, the **Content** section of `launchpad status` includes these rows:

| Row | Meaning |
| --- | --- |
| **Version** | The active version id and when it was promoted, or `none yet` before the first versioned fetch. |
| **Retained** | The number of version directories on disk and the configured `keepVersions` value. It warns when one or more directories are pending deletion; cleanup retries them after the next successful fetch. |
| **Acks** | A list of consumer leases, shown only when lease files exist. Fresh leases are healthy; expired leases are neutral because expiry is expected behavior. |

With versioning disabled, none of these rows appear.
