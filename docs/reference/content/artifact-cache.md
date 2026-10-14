# Artifact Cache

Launchpad uses one shared artifact cache for downloaded media, Sharp images, and custom derived files. It requires Node.js **24.x or 26 and later** (`^24 || >=26`) for the built-in `node:sqlite` module.

## Storage and scope

Metadata lives in `.launchpad/cache/artifacts.sqlite`, relative to the project working directory. The database stores identities, local file fingerprints, and HTTP policy metadata, not file bodies. The previously published download tree supplies reusable files; there is no blob store or second permanent copy of the bytes.

Records are scoped to a content source. Identical work can be coalesced within a source, but artifacts are not shared between sources. Reused files are copied into the current run's staging tree at their existing relative paths.

A published file without trusted metadata is a cache miss. Existing outputs and backups are not imported as trusted entries. The first run after upgrading may download or generate them again.

## Local file verification

For a previously published output candidate, persisted fingerprints use matching local size and modification time as the fast path. If either attribute changes, Launchpad hashes the local bytes with SHA-256 and compares the recorded content identity. Missing files or a different hash are misses.

Input fingerprints are memoized only within the current run: the first read hashes each input, and subsequent reads can reuse that hash while its size and modification time match. Inputs must remain stable throughout generator execution.

The stat fast path does **not** cryptographically verify every hit. Same-size edits with a preserved or restored modification time can evade both output-candidate checks and within-run input checks. Do not rely on it to detect such edits.

These checks concern **local** content only. Neither a local file's modification time nor equality with a remote `Content-Length` establishes that a remote resource is unchanged. HTTP freshness and validation are handled separately.

## Downloaded media

The media downloader evaluates a private HTTP cache policy:

- An explicit freshness lifetime, such as `Cache-Control: max-age` or `Expires`, can allow reuse without a network request. Freshness starts when response headers arrive and includes time spent downloading the body.
- There is no heuristic freshness lifetime. Without an explicit lifetime, the downloader contacts the server each run.
- Stale responses are revalidated with conditional **GET** requests using the server's `ETag` or `Last-Modified`, when available. Local modification times are not sent as server validators.
- `no-store` prevents reusable metadata from being retained. `no-cache` requires revalidation before reuse.
- `Vary` and request identity constrain reuse; `Vary: *` is not reusable.
- Stale reuse after a network/server error requires an applicable `stale-if-error` allowance. It is not a general offline fallback, and `no-cache` or `must-revalidate` prevents it.

Freshness or a `304 Not Modified` response cannot substitute for missing or corrupt local bytes. Without a verified local body, the downloader needs a full response.

See [mediaDownloader options](./transforms/media-downloader.md) for unconditional downloads and temporary-file cleanup.

## Derived artifacts: `cache.derive()`

Every `ContentTransformContext` includes a run-owned `cache: ArtifactCache`. This public type is a structural artifact capability, also exported as `ArtifactCacheCapability`; it does not expose publication, invalidation, abort, or database-close methods. Custom transforms use its `derive()` method. Launchpad owns the database and publication lifecycle.

The following types are exported from `@bluecadet/launchpad/content`:

```typescript
type DerivedArtifact = {
  sourceId: string;
  namespace: string;
  version: string;
  inputs: readonly string[];
  options: JsonValue;
  outputs: readonly string[];
  generate: () => Promise<void>;
};

type ArtifactResult = { reused: boolean };

// On the context's ArtifactCache:
// cache.available: boolean
// cache.derive(artifact: DerivedArtifact): Promise<ArtifactResult>
```

`JsonValue` is JSON-compatible data: strings, numbers, booleans, null, arrays, and objects. Functions and buffers are not valid `options` values.

| Field | Contract |
|---|---|
| `sourceId` | The content source that owns this artifact. |
| `namespace` | A stable recipe identifier, distinct from other recipes. |
| `version` | Your recipe revision. Change it when generation logic changes. |
| `inputs` | Local input/dependency file paths. Use absolute paths; include every file that can affect output. Input order is part of the identity. |
| `options` | Resolved, JSON-compatible options, including any declared tool/engine versions or other supplemental dependencies. Object key insertion order does not affect identity. |
| `outputs` | A nonempty list of output paths relative to `paths.getDownloadPath(sourceId)`. Paths must stay inside that source's staged tree. |
| `generate` | An awaited callback that writes every declared output into staging. Called on a miss, not on a hit. |

Identity includes the namespace, recipe version, input content hashes, options, and output paths. A hit restores the verified outputs into staging and returns `{ reused: true }`. An identical call can also reuse a completed artifact already in staging, after hashing every declared output against its captured content. Missing or changed staged outputs trigger restoration or regeneration rather than returning a previously settled result. Generation returns `{ reused: false }`. Missing inputs and missing or unstable generated outputs are errors, not successful cache entries. Generation errors propagate normally.

Inputs and outputs must be distinct to cache. If an output is also a declared input at the same staged path, generation runs uncached. In a multi-output recipe, only those in-place destinations are exempt from ownership claims; all other outputs are reserved before generation and must not conflict with another artifact. In-place downstream changes also prevent reuse of an upstream entry whose final bytes no longer match its original output.

Writable artifact destinations reject existing symlinks (including symlinked components within the source root) and hard-linked output files rather than silently modifying aliased files in an old publication.

For custom recipes, the caller is responsible for declaring code revisions, tools, and dependencies. The cache does not inspect a callback or discover an ffmpeg installation. File hashes do not detect changes to a remote URL until its new bytes have been downloaded locally. Sharp's automatic recipe/dependency discovery is specific to the [Sharp adapter](./transforms/sharp.md).

Identical derived work in a source is coalesced. Different cached/download identities claiming the same output path are rejected rather than allowing one to overwrite the other. Existing filename conventions are unchanged; the separate [filename redesign (#321)](https://github.com/bluecadet/launchpad/issues/321) is not part of this cache.

See [cache a custom transform](../../recipes/custom-content-transform.md#cache-generated-files) for an ffmpeg example.

## Publication and failures

Only one publishing writer may operate on a project at a time. Launchpad enforces ownership through operating-system leases, with the content writer lease at `.launchpad/content-writer.lock` outside the resettable cache directory. Parallel download and generation tasks within that run remain supported.

Launchpad owns the cache lifecycle. It stages records during the run, durably marks affected metadata unsafe before publication changes files, and commits metadata only after publication settles and final output hashes match. Interrupted publication cannot make old metadata trustworthy on restart. Outputs modified by later transforms are not recorded as the original recipe's result.

Cache infrastructure failures warn and fall back to uncached work only when old metadata can be safely invalidated or isolated. If SQLite cannot record invalidation, Launchpad flushes an untrusted-cache marker before publication. On Windows, the file flush also persists filesystem metadata; POSIX systems additionally sync the marker's directory. On restart, Launchpad clears and flushes existing database and recovery files in place before removing that marker, so recovery does not depend on database-file deletions surviving a crash. The project writer lease stays intact throughout recovery.

If any required durability barrier fails, publication fails rather than overwriting files with potentially reusable stale metadata. Actual download and generation failures retain their normal error handling. Ordinary cache misses are not errors.

Database tables, HTTP policy serialization, safety markers, and diagnostic text are implementation details, not a stable SQL or diagnostics API. Do not edit the database or remove lease files to force a refresh.

## Clearing

`content.clear` uses flat command fields:

| Field | Default | Effect |
|---|---|---|
| `sources` | All configured sources | Limits the operation to these source IDs. |
| `downloads` | `true` | Deletes the selected sources' published downloads **and** invalidates their artifact records. With versioning, clears selected source directories in the active version, not historical retained versions. |
| `cache` | `false` | Invalidates artifact metadata, even if `downloads` is `false`. |
| `temp` | `false` | Clears temporary staging files. |
| `backups` | `false` | Clears backups. |

To invalidate metadata while preserving published files, set **both** `downloads: false` and `cache: true`. For a started controller with the content plugin registered:

```typescript
import type { LaunchpadController } from '@bluecadet/launchpad/controller';

async function clearArtifactCache(controller: LaunchpadController) {
  const result = await controller.executeCommand({
    type: 'content.clear',
    sources: ['videos'], // Omit to invalidate all configured sources
    downloads: false,
    cache: true,
  });
  if (result.isErr()) throw result.error;
}
```

Inside another plugin, dispatch the same command with `ctx.dispatchCommand()` from its `PluginContext`. This dispatch helper is not part of `ContentTransformContext`; clear between fetch runs, not from a generation callback.

Normal run cleanup and temporary-file clearing preserve the artifact database. On a cache-only clear, published files remain available to applications, but the next fetch must establish new trusted records.

## Related pages

- [Content transform context](./transforms/index.md)
- [Downloading media](../../guides/downloading-media.md)
