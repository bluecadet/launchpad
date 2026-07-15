---
title: "Version Manifest"
---

# Version Manifest

This page defines the contract for an application that consumes versioned Launchpad content. Given a content root directory, read its `manifest.json` to discover the active content version. You do not need to know the Launchpad configuration or the on-disk layout beneath that root.

The manifest is the authoritative notification mechanism. It is replaced atomically, so a reader sees either the complete previous manifest or the complete next manifest, never partial JSON.

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
| `schemaVersion` | Contract version. This page defines version `1`. A consumer must understand the version before using the manifest, and must ignore fields it does not recognize in a supported version. New fields can therefore be added without breaking consumers. |
| `versionId` | Identifier for this promoted fetch. It is a UTC timestamp-shaped string and is also the current version directory name. |
| `versionPath` | A relative, forward-slash path from the content root to this version's directory. |
| `generatedAt` | ISO 8601 time at which Launchpad generated this manifest. It is informational. |
| `sources` | The source directories available in this version. Each `path` is relative to `versionPath`; `sourceId` identifies the configured source. |

## Reading content

Build a source's location by joining the content root, `versionPath`, and that source's `path`:

```text
<content root>/<versionPath>/<sources[n].path>
```

For the example above, the `exhibits` source is at:

```text
<content root>/versions/20260714T153045Z/exhibits
```

Always use the paths in the manifest. Do **not** construct paths such as `versions/<versionId>/<sourceId>` by convention: the directory layout under a version is private to Launchpad and can change.

A promoted version is immutable. Keep using the version you already loaded until your application is ready to switch to a newer one.

## Detecting a new version

`versionId` is the sole change-detection key. Cache the last version id you loaded, then reload when a successfully read manifest contains a different value.

A changed version id means **a fetch was promoted**, not that the content differs. Launchpad can promote byte-identical content as a new version. Applications for which a reload is disruptive should compare the content they care about after observing a new id.

Do not use `generatedAt`, manifest file modification times, or content file modification times as change signals.

Poll `manifest.json` every 5–30 seconds. Polling this small file is the portable, authoritative contract; a filesystem watcher may reduce latency but is optional and must not replace polling.

## Acknowledging a version

If an application needs to keep a loaded version beyond normal retention, it can write a lease file:

```text
<content root>/acks/<consumerId>.json
```

The file contains only the loaded version id:

```json
{ "versionId": "20260714T153045Z" }
```

Use a stable consumer id that is safe as a filename. Rewrite the file periodically as a heartbeat. Lease freshness comes from the file's modification time, not from a timestamp in the JSON body.

A fresh lease retains its named version in addition to the normal keep count. Once its modification time is older than the configured `ackTimeout` (30 minutes by default), Launchpad ignores it and the version is eligible for deletion again. Renew substantially more often than `ackTimeout` to allow for a missed heartbeat.

A lease only extends retention; it does not block cleanup forever. An application that does not write a lease must reload promptly after detecting a new `versionId`, because its old version can be deleted once it falls outside normal retention.

Node consumers connected to a running Launchpad daemon can instead renew the same lease through `content.ack`. See the [IPCClient consumer recipe](/recipes/live-content-refresh#node-consumers-with-ipcclient).

## Platform guidance

### Unity and .NET

Open `manifest.json` with `FileShare.Read | FileShare.Delete`, then close the handle immediately. Close content-file handles between polls as well. A .NET or Unity reader that omits delete sharing can prevent Launchpad from atomically replacing the manifest or removing an old version on Windows.

### Browsers

Fetch the manifest without using a cached response:

```javascript
const response = await fetch("/content/manifest.json", { cache: "no-store" });
const manifest = await response.json();
```

### Node.js

Node readers are safe by default: libuv opens files with Windows delete sharing enabled. Continue to treat the manifest as the source of truth and poll it as described above.
