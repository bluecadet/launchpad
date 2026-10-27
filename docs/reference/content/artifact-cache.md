# Artifact cache

Launchpad keeps one artifact cache for downloaded media, Sharp images, and custom derived files. The cache uses the built-in `node:sqlite` module and requires Node.js **24.x or 26 and later** (`^24 || >=26`).

## Storage and scope

Metadata is stored in `.launchpad/cache/artifacts.sqlite`, relative to the project working directory. The database holds identities, local file fingerprints, and HTTP policy metadata, but no file bodies. Reusable files come from the previously published download tree; there is no blob store or second copy of the bytes.

Records belong to one content source. Launchpad coalesces identical work within a source but never shares artifacts between sources. It copies reused files into the current run's staging tree at their existing relative paths.

A published file without trusted metadata is a cache miss. Launchpad does not import existing outputs or backups as trusted entries, so the first run after upgrading may download or generate them again.

## Local file verification

For a previously published output, a matching local size and modification time is the fast path. If either differs, Launchpad hashes the local bytes with SHA-256 and compares them to the recorded content identity. A missing file or different hash is a miss.

Input fingerprints are memoized within the current run only. The first read hashes each input, and later reads reuse that hash while size and modification time match. Inputs must stay unchanged while generators run.

The fast path does **not** cryptographically verify every hit. A same-size edit with a preserved or restored modification time passes both the output check and the within-run input check. Do not rely on these checks to catch such edits.

These checks cover **local** content only. Neither a local modification time nor a match with a remote `Content-Length` proves a remote resource is unchanged; HTTP freshness and validation handle that separately.

## Downloaded media

The media downloader applies a private HTTP cache policy:

- An explicit freshness lifetime, such as `Cache-Control: max-age` or `Expires`, can allow reuse without a network request. Freshness starts when response headers arrive, so it includes time spent downloading the body.
- There is no heuristic freshness lifetime. Without an explicit lifetime, the downloader contacts the server every run.
- The downloader revalidates stale responses with conditional **GET** requests using the server's `ETag` or `Last-Modified`, when available. It never sends local modification times as validators.
- `no-store` prevents reusable metadata from being retained. `no-cache` requires revalidation before reuse.
- `Vary` and request identity constrain reuse; `Vary: *` is not reusable.
- Reusing a stale response after a network or server error requires an applicable `stale-if-error` allowance. This is not a general offline fallback, and `no-cache` or `must-revalidate` prevents it.

Freshness or a `304 Not Modified` response cannot replace missing or corrupt local bytes. Without a verified local body, the downloader needs a full response.

See [mediaDownloader options](./transforms/media-downloader.md) for unconditional downloads and temporary-file cleanup.

## Derived artifacts: `cache.derive()`

Every `ContentTransformContext` includes a run-owned `cache: ArtifactCache`. This structural type, also exported as `ArtifactCacheCapability`, exposes no publication, invalidation, abort, or database-close methods. Custom transforms call its `derive()` method; Launchpad owns the database and publication lifecycle.

`@bluecadet/launchpad/content` exports these types:

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

`JsonValue` is JSON-compatible data: strings, numbers, booleans, null, arrays, and objects. `options` cannot contain functions or buffers.

| Field | Contract |
|---|---|
| `sourceId` | The content source that owns this artifact. |
| `namespace` | Stable recipe identifier, unique among recipes. |
| `version` | Recipe revision. Change it when generation logic changes. |
| `inputs` | Absolute paths of local input and dependency files. Include every file that can affect output. Order is part of the identity. |
| `options` | Resolved, JSON-compatible options, including declared tool or engine versions and other dependencies. Object key order does not affect identity. |
| `outputs` | Nonempty list of output paths relative to `paths.getDownloadPath(sourceId)`, inside that source's staged tree. |
| `generate` | Awaited callback that writes every declared output into staging. Runs only on a miss. |

Identity covers the namespace, recipe version, input content hashes, options, and output paths. A hit restores the verified outputs into staging and returns `{ reused: true }`. An identical call can also reuse a completed artifact already in staging after hashing every declared output against its captured content; missing or changed staged outputs trigger restoration or regeneration. Generation returns `{ reused: false }`. Missing inputs and missing or unstable generated outputs are errors and never become cache entries. Generation errors propagate normally.

Caching requires distinct inputs and outputs. If an output is also a declared input at the same staged path, generation runs uncached. In a multi-output recipe, only those in-place destinations skip ownership claims; Launchpad reserves every other output before generation, and those outputs must not conflict with another artifact. In-place downstream changes also block reuse of an upstream entry whose final bytes no longer match its original output.

Writable artifact destinations reject existing symlinks, including symlinked components within the source root, and hard-linked output files, so an old publication's aliased files are never modified.

Custom recipes must declare their own code revisions, tools, and dependencies. The cache does not inspect callbacks or discover an ffmpeg installation. File hashes cannot detect a changed remote URL until the new bytes are downloaded. Only the [Sharp adapter](./transforms/sharp.md) discovers recipes and dependencies automatically.

Launchpad coalesces identical derived work within a source and rejects different cached or download identities that claim the same output path. Filename conventions are unchanged; the [filename redesign (#321)](https://github.com/bluecadet/launchpad/issues/321) is separate from this cache.

See [cache a custom transform](../../recipes/custom-content-transform.md#cache-generated-files) for an ffmpeg example.

## Publication and failures

Only one publishing writer can operate on a project at a time. Launchpad enforces this with operating-system leases; the content writer lease is `.launchpad/content-writer.lock`, outside the resettable cache directory. Download and generation tasks still run in parallel within a run.

Launchpad owns the cache lifecycle. It stages records during the run, durably marks affected metadata unsafe before publication changes files, and commits metadata only after publication settles and final output hashes match. An interrupted publication cannot make old metadata trusted on restart. Launchpad does not record outputs modified by later transforms as the original recipe's result.

When cache infrastructure fails, Launchpad warns and falls back to uncached work only if it can safely invalidate or isolate old metadata. If SQLite cannot record invalidation, Launchpad flushes an untrusted-cache marker before publication. On Windows, the flush also persists filesystem metadata; on POSIX systems, Launchpad also syncs the marker's directory. On restart, Launchpad clears and flushes the existing database and recovery files in place before removing the marker, so recovery does not depend on file deletions surviving a crash. The project writer lease stays in place throughout recovery.

If a required durability barrier fails, publication fails instead of leaving stale metadata that could mark overwritten files reusable. Download and generation failures keep their normal error handling. Ordinary cache misses are not errors.

Database tables, HTTP policy serialization, safety markers, and diagnostic text are implementation details, not a stable SQL or diagnostics API. Do not edit the database or remove lease files to force a refresh.

## Clearing

`content.clear` uses flat command fields:

| Field | Default | Effect |
|---|---|---|
| `sources` | All configured sources | Source IDs to operate on. |
| `downloads` | `true` | Deletes the selected sources' published downloads **and** invalidates their artifact records. With versioning, clears the selected source directories in the active version only, not in retained older versions. |
| `cache` | `false` | Invalidates artifact metadata, even if `downloads` is `false`. |
| `temp` | `false` | Clears temporary staging files. |
| `backups` | `false` | Clears backups. |

To invalidate metadata and keep published files, set **both** `downloads: false` and `cache: true`. With a started controller and the content plugin registered:

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

Inside another plugin, dispatch the same command with `ctx.dispatchCommand()` from its `PluginContext`. `ContentTransformContext` has no dispatch helper; clear between fetch runs, not from a generation callback.

Normal run cleanup and temporary-file clearing keep the artifact database. After a cache-only clear, applications can still read published files, but the next fetch must establish new trusted records.

## Related pages

- [Content transform context](./transforms/index.md)
- [Downloading media](../../guides/downloading-media.md)
