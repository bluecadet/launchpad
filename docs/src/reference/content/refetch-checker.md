---
title: "Refetch Checker"
---

# Refetch Checker

`refetchChecker` is a check-before-fetch plugin. Its `refetch.check` command asks your CMS for its most recent modification value and dispatches `content.fetch` only when that value is newer than the last one seen. On a fast schedule this prevents the [versioned output](./versioning) churn where every fetch mints a new `versionId` and every polling application reloads on identical content.

For the full setup — scheduler, versioning, and consumer patterns — see the [Live Content Refresh recipe](/recipes/live-content-refresh).

## Configuration

```typescript
import { content, refetchChecker } from "@bluecadet/launchpad/content";

refetchChecker({
  getLatestModifiedAt: async ({ abortSignal }) => {
    // Ask your CMS for its most recent modification value.
    return "2026-07-15T12:00:00.000Z";
  },
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `getLatestModifiedAt` | `(helpers: { abortSignal, logger }) => Promise<string>` | required | CMS-specific freshness probe. Return the most recent modification value the CMS reports, in a format whose lexicographic order matches chronological order (an ISO 8601 timestamp qualifies). The `abortSignal` aborts on shutdown; pass it to your request. |
| `downloadPath` | `string` | discovered | Where to read the active version manifest used as the first baseline after boot. By default the checker asks the content plugin via `content.manifest.read`, so it needs no path of its own. Set this only when the manifest lives somewhere the content plugin doesn't manage. Relative paths resolve against the launchpad working directory. |

## `refetch.check`

```typescript
{ type: 'refetch.check' }
```

Runs one check. The decision rules:

- The baseline for the first check after boot is the active manifest's `generatedAt`. Every later check compares against the last CMS value seen in memory, so clock skew between the CMS and the local machine can cause at most one wrong decision per restart.
- No readable manifest and no in-memory value means the check fetches unconditionally. This covers fresh installs and self-heals a failed boot fetch.
- The dispatched `content.fetch` is awaited before the check completes, so a scheduled interval measures from the end of the whole check-and-fetch cycle and a fetch failure fails the check. The last seen CMS value is recorded only after a successful fetch; a failed fetch leaves the change unseen and the next check fetches again.

Pair the checker with the content plugin and versioning enabled. Without versioning there is no manifest, so the first check after boot always fetches; later checks still compare in memory.

## Manifest discovery: `content.manifest.read`

The content plugin registers a `content.manifest.read` command that returns the active version manifest as data:

```typescript
{ type: 'content.manifest.read' }
```

The result is one of:

```typescript
{ status: 'ok', manifest: Manifest }
{ status: 'missing' }
{ status: 'invalid', message: string }
```

`refetchChecker` uses it to locate its baseline without duplicating the content plugin's `downloadPath`. Any dispatcher — another plugin, or a Node consumer connected over IPC — can use it the same way to read the manifest without knowing where it lives on disk.
