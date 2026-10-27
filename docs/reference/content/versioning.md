---
title: "Content versioning"
---
Versioning publishes each successful fetch as a new, immutable content version. It is opt-in; without it, content uses the flat `downloadPath` layout.

See [Version manifest](./version-manifest.md) for how an application discovers and reads a version.

## Configuration

Set `versioning` on the content plugin:

```typescript
content({
  versioning: true,
});
```

`true` uses the defaults. Pass an object to change retention or ack-lease lifetime:

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
| `keepVersions` | `number` | `3` | Number of newest version directories to keep. The active version and versions named by fresh ack leases are kept in addition. |
| `ackTimeout` | `string \| number` | `"30m"` | How long an ack lease stays fresh. Accepts milliseconds or duration strings such as `"30s"`, `"5m"`, and `"2h"`. |

## Publishing a version

A successful fetch moves its complete staged output into `versions/<versionId>/` under `downloadPath`. Launchpad then atomically replaces `manifest.json` to point at that directory. The manifest replacement is the commit point; until it succeeds, applications keep using the previous version.

Promoted versions are immutable. A failed promotion can leave an unreferenced orphan directory, which is never the active version.

Versioning silently overrides `backupAndRestore`. Retained version directories provide recovery, and a fetch never modifies the active version.

### Subset fetches

With versioning enabled, Launchpad rejects a `content.fetch` command that names a subset of sources. Promotion moves the whole staged output into a new version and rebuilds the manifest from the fetched sources, so a subset fetch would publish a version missing every skipped source. Fetch all sources, or disable versioning to fetch per source. Flat output mode still supports subset fetches.

## Retention and cleanup

After each successful versioned fetch, Launchpad tries to delete every directory in `versions/` outside the retention set. The set contains:

- the `keepVersions` newest version directories by version id
- the version named by the current manifest
- any version named by a fresh consumer ack lease

Deletion is best-effort. A locked directory, including one partially deleted on Windows, stays eligible and is retried after the next successful versioned fetch. Orphans follow the same rule and age out normally.

Fresh ack leases extend retention but never make a version permanent. The sweep ignores a lease older than `ackTimeout`. See [acknowledging a version](./version-manifest.md#acknowledging-a-version) for the consumer-side protocol.

## Failure and clear behavior

A failure before publication leaves published content untouched. Once a version's manifest is replaced, a later cleanup failure does not remove that version. Cache metadata stays unsafe until a later successful fetch settles it.

In flat mode with `backupAndRestore` enabled, a publication or temporary-file cleanup failure can restore the previous source files. Launchpad prepares the restore in the run directory before replacing published files. If recovery fails, it keeps the run files and backups for manual recovery. Once backup deletion begins, rollback is no longer possible; a deletion failure reports an error and leaves the new published files in place.

`content.clear` resolves and validates every deletion target before changing files or cache metadata. Download clearing and versioned seeding also reject manifest source roots that overlap on disk, including case aliases on case-insensitive volumes. A clear with `downloads: false` skips the active manifest, so cache-only, temporary-file, and backup clears still work when the manifest is invalid.

A source-filtered temporary clear removes that source's entries in the run layout and in the temporary namespaces of the configured transforms. A source named `runs`, `downloads`, or after a transform does not authorize deletion of the containing namespace. Unknown historical transform namespaces are preserved. Without a layout record, a direct temporary source directory with subdirectories is ambiguous, so a filtered clear refuses to delete it rather than risk another source's files. Use an all-source temporary clear to remove historical or ambiguous files:

```typescript
await controller.dispatchCommand({
  type: "content.clear",
  downloads: false,
  temp: true,
});
```

This preserves published downloads and artifact metadata. Before clearing temporary or backup directories, copy out any files kept for manual recovery.

## Switching modes

Neither output mode migrates or cleans up the other's artifacts. Turning versioning on leaves existing flat output in place; turning it off leaves `manifest.json`, `versions/`, and `acks/` in place. Artifacts from the inactive mode are inert.

Remove them manually only after confirming no application still uses them.

## Status

With versioning enabled, the **Content** section of `launchpad status` adds these rows:

| Row | Meaning |
| --- | --- |
| **Version** | Active version id and promotion time, or `none yet` before the first versioned fetch. |
| **Retained** | Version directories on disk and the configured `keepVersions`. Warns when directories are pending deletion; cleanup retries them after the next successful fetch. |
| **Acks** | Consumer leases, shown only when lease files exist. Fresh leases show as healthy; expired leases show as neutral, since expiry is expected. |

With versioning disabled, these rows do not appear.
