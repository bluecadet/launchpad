---
title: "Refetch checker"
---
`refetchChecker` is a check-before-fetch plugin. Its `refetch.check` command asks your CMS for its latest modification value and dispatches `content.fetch` only when that value is newer than the last one seen. On a fast schedule, this keeps [versioned output](./versioning.md) from minting a new `versionId` on every fetch and making every polling application reload identical content.

The [live content refresh recipe](../../recipes/live-content-refresh.md) covers the full setup, including the scheduler, versioning, and consumer patterns.

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
| `getLatestModifiedAt` | `(helpers: { abortSignal, logger }) => Promise<string>` | required | CMS-specific freshness probe. Return the CMS's latest modification value in a format whose lexicographic order matches chronological order, such as an ISO 8601 timestamp. `abortSignal` aborts on shutdown; pass it to your request. |
| `downloadPath` | `string` | discovered | Location of the version manifest that supplies the first baseline after boot. By default the checker asks the content plugin through `content.manifest.read` and needs no path. Set this only when the content plugin does not manage the manifest. Relative paths resolve against the launchpad working directory. |

## `refetch.check`

```typescript
{ type: 'refetch.check' }
```

Runs one check:

- The first check after boot compares against the active manifest's `generatedAt`. Later checks compare against the last CMS value held in memory, so clock skew between the CMS and the local machine can cause at most one wrong decision per restart.
- With no readable manifest and no value in memory, the check always fetches. This covers fresh installs and recovers from a failed boot fetch.
- The check awaits the dispatched `content.fetch`, so a scheduled interval measures from the end of the check-and-fetch cycle, and a failed fetch fails the check. The checker records the CMS value only after a successful fetch, so the next check retries a failed one.

Use the checker with the content plugin and versioning enabled. Without versioning there is no manifest, so the first check after boot always fetches; later checks still compare in memory.

## Manifest discovery

The content plugin registers a `content.manifest.read` command that returns the active version manifest:

```typescript
{ type: 'content.manifest.read' }
```

The result is one of:

```typescript
{ status: 'ok', manifest: Manifest }
{ status: 'missing' }
{ status: 'invalid', message: string }
```

`refetchChecker` uses it to find its baseline without duplicating the content plugin's `downloadPath`. Any dispatcher, such as another plugin or a Node consumer connected over IPC, can call it to read the manifest without knowing its location on disk.
