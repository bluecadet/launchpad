---
title: "Version manifest"
---
This page defines the contract for applications that read versioned Launchpad content. Read `manifest.json` in the content root to find the active version. You need neither the Launchpad configuration nor the on-disk layout beneath the root.

The manifest is the authoritative change signal. Launchpad replaces it atomically, so a reader sees the complete previous or complete next manifest, never partial JSON.

## Manifest schema

A version-1 manifest has this shape:

```json
{
  "schemaVersion": 1,
  "versionId": "20260714T153045Z",
  "versionPath": "versions/20260714T153045Z",
  "generatedAt": "2026-07-14T15:30:47.112Z",
  "sources": [
    { "sourceId": "exhibits", "path": "exhibits" },
    { "sourceId": "labels", "path": "labels" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Contract version. This page defines version `1`. A consumer must support the version before using the manifest and must ignore unrecognized fields in a supported version, so new fields can be added without breaking consumers. |
| `versionId` | Identifier for this promoted fetch: a UTC timestamp-shaped string that also names the current version directory. |
| `versionPath` | A relative, forward-slash path from the content root to this version's directory. |
| `generatedAt` | ISO 8601 time Launchpad generated this manifest. Informational only. |
| `sources` | Source directories in this version. Each `path` is relative to `versionPath`; `sourceId` names the configured source. |

## Reading content

Build a source's location by joining the content root, `versionPath`, and that source's `path`:

```text
<content root>/<versionPath>/<sources[n].path>
```

For the example above, the `exhibits` source is at:

```text
<content root>/versions/20260714T153045Z/exhibits
```

Always use the manifest's paths. Do **not** build paths such as `versions/<versionId>/<sourceId>` by convention; the layout under a version is private to Launchpad and can change.

A promoted version is immutable. Keep using the loaded version until your application is ready to switch.

## Detecting a new version

`versionId` is the only change-detection key. Store the last version id you loaded, and reload when a successfully read manifest has a different value.

A new version id means **a fetch was promoted**; the content may be byte-identical. If reloading is disruptive, compare the content you care about after seeing a new id.

Do not use `generatedAt`, manifest file modification times, or content file modification times as change signals.

Poll `manifest.json` every 5-30 seconds. Polling is the portable, authoritative contract. A filesystem watcher can reduce latency but must not replace polling.

## Acknowledging a version

To keep a loaded version beyond normal retention, write a lease file:

```text
<content root>/acks/<consumerId>.json
```

The file holds only the loaded version id:

```json
{ "versionId": "20260714T153045Z" }
```

Use a stable consumer id that is safe as a filename. Rewrite the file periodically as a heartbeat. Launchpad judges freshness by the file's modification time and ignores any timestamp in the JSON.

A fresh lease keeps its version in addition to the normal keep count. Once the file is older than `ackTimeout` (30 minutes by default), Launchpad ignores the lease and the version becomes eligible for deletion. Renew well within `ackTimeout` so one missed heartbeat does no harm.

A lease extends retention but cannot block cleanup forever. An application without a lease must reload promptly after detecting a new `versionId`, because Launchpad can delete its old version once it falls outside normal retention.

Node consumers connected to a running Launchpad daemon can renew the lease with `content.ack` instead, and read the active manifest without knowing its location with [`content.manifest.read`](./refetch-checker.md#manifest-discovery). See the [IPCClient consumer recipe](../../recipes/live-content-refresh.md#node-consumers-with-ipcclient).

Browser and Unity/.NET consumers that cannot open the IPC socket can call both commands over plain HTTP through the [HTTP/SSE transport](../controller/transports.md).

## Platform guidance

### Unity and .NET

Open `manifest.json` with `FileShare.Read | FileShare.Delete` and close the handle immediately. Close content-file handles between polls too. On Windows, a reader without delete sharing can block Launchpad from replacing the manifest or removing an old version.

### Browsers

Fetch the manifest without the HTTP cache:

```javascript
const response = await fetch("/content/manifest.json", { cache: "no-store" });
const manifest = await response.json();
```

### Node.js

Node readers are safe by default, because libuv opens files with Windows delete sharing enabled. Poll the manifest as described above.
