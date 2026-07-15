# @bluecadet/launchpad-content

## 3.1.0

### Minor Changes

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`47cfc57`](https://github.com/bluecadet/launchpad/commit/47cfc57edf36753d9d162968060c938038e60a6d) - Show the active version, retained-version cleanup status, and consumer ack leases in Content status when versioning is enabled.

- [#310](https://github.com/bluecadet/launchpad/pull/310) [`27b06d8`](https://github.com/bluecadet/launchpad/commit/27b06d844132da8859457878e9c8b1d30dc48e5a) - Add `refetchChecker`, a packaged check-before-fetch plugin. Its `refetch.check` command asks the CMS for its latest modification value via a user-supplied `getLatestModifiedAt` probe and dispatches `content.fetch` only when that value is newer, so fast schedules stop minting a new content version (and reloading every polling app) on identical content. The first check after boot compares against the active manifest's `generatedAt`; later checks compare CMS values in memory; a missing or unreadable manifest fetches unconditionally.

  Add a `content.manifest.read` command that returns the active version manifest as JSON-safe data (`ok`/`missing`/`invalid`). `refetchChecker` uses it to find its baseline without duplicating `downloadPath`; IPC consumers and other plugins can use it to read the manifest without knowing its on-disk location.

  Export the manifest read API (`readManifest`, `Manifest`, `ManifestReadResult`, `ManifestError`, `MANIFEST_FILENAME`) from the package root.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`47cfc57`](https://github.com/bluecadet/launchpad/commit/47cfc57edf36753d9d162968060c938038e60a6d) - Add the keep-N retention sweep for versioned output, run at the end of each successful versioned fetch. The retention set is the `keepVersions` newest version dirs by name (default 3), union the manifest's active version, union any version named by a fresh ack lease (`<downloadPath>/acks/<consumerId>.json`, freshness by mtime vs `ackTimeout`, default 30m); everything else under `versions/` is deleted. Deletion is best-effort and idempotent -- a locked dir is left in place and retried on the next sweep. Sweep results (retained/pending-delete counts, per-consumer ack freshness) are tracked on the content plugin's state.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`47cfc57`](https://github.com/bluecadet/launchpad/commit/47cfc57edf36753d9d162968060c938038e60a6d) - Add the `content.ack` command: IPC sugar that writes/renews `<downloadPath>/acks/<consumerId>.json` with `{ versionId }`, the same lease file an app could write itself. Both `consumerId` and `versionId` are required -- there's no acking "whatever is current" -- and `consumerId` is sanitized against path traversal. Errors cleanly with `versioning` off, since the acks directory concept doesn't exist otherwise.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`47cfc57`](https://github.com/bluecadet/launchpad/commit/47cfc57edf36753d9d162968060c938038e60a6d) - Wire versioned output into the fetch pipeline: under `versioning`, `finalizingStage` moves the staged downloads root whole into `versions/<versionId>/` and atomically swaps `manifest.json` as the sole commit point, emitting `content:version:promoted` right after. `backupStage` and the restore half of `errorRecoveryStage` are silent no-ops under versioning (retained versions are the backup); a failed promotion instead best-effort deletes the orphaned version dir. Opt-in via `versioning` config; no change to default output behavior.

### Patch Changes

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`47cfc57`](https://github.com/bluecadet/launchpad/commit/47cfc57edf36753d9d162968060c938038e60a6d) - Validate `versioning.keepVersions` as a non-negative integer. Fractional or negative values are now rejected at config parse time. `0` remains valid and means retention relies solely on the active-version and fresh-ack backstops.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`47cfc57`](https://github.com/bluecadet/launchpad/commit/47cfc57edf36753d9d162968060c938038e60a6d) - Harden versioned-output promotion against same-second collisions. Two fetches promoted within the same UTC second previously minted the same second-granular version id; the second promotion's move failed and its error cleanup could delete the first fetch's live, manifest-referenced version. Promotion now resolves a collision-free id up front (bumping to a lexically-ordered `<id>-01` suffix when the directory already exists) before moving, so the move never lands on an existing version and error cleanup can only ever remove this run's own directory. Orphan cleanup on the error path now uses the same retry policy as the retention sweep, and the sweep additionally reaps stale `.manifest.json.tmp-*` scratch files left by a crash mid-write.

  Reject a `content.fetch` that names a subset of sources while versioning is enabled. Promotion moves the entire staged root and rebuilds the manifest from the fetched sources, so a subset fetch would silently drop every unfetched source from the active version. Subset fetches remain supported in the flat output mode.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`e4c6d48`](https://github.com/bluecadet/launchpad/commit/e4c6d487e829a3df18c261fa8f9a808ff73a6d62) - Add a configurable `maxTimeout` option (default 60s) to the Airtable, Contentful, and Sanity sources, wired into each SDK's native request timeout (`requestTimeout`, `timeout`, `timeout` respectively). Previously these sources built their SDK clients with no timeout, so a stalled connection could hang an unattended scheduled fetch indefinitely.

- Updated dependencies [[`13cfbe6`](https://github.com/bluecadet/launchpad/commit/13cfbe6ce9bb9efb7a3a3d5d16080538af040acf), [`3665436`](https://github.com/bluecadet/launchpad/commit/3665436402021470f2e9654e81fa978a8fe4daff), [`53fb2fc`](https://github.com/bluecadet/launchpad/commit/53fb2fc74cecd47b33585618a6b39d875d308b02)]:
  - @bluecadet/launchpad-utils@3.1.0

## 3.0.0

### Major Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Breaking changes to the content fetch pipeline, path helpers, and file path defaults. See the `@bluecadet/launchpad` changelog for migration details.

- [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2) - Replaces the hook-based plugin system with a unified plugin model across all packages. See the `@bluecadet/launchpad` changelog for migration details.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Introduces `StatusSnapshot` and `ctx.updateState()` for plugin status and state management. See the `@bluecadet/launchpad` changelog for migration details.

### Minor Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789) - Emit `content:source:error` event when an individual content source fails during a fetch.

  Previously, source errors were only surfaced through the fetch result. Now a `content:source:error` event is emitted on the event bus with `{ sourceId, error }`, allowing subscribers to react to partial failures without waiting for the entire fetch to complete.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789) - Introduce `EventBus<TEvents>` and per-package event types.

  `EventBus<TEvents extends Record<string, unknown>>` is available from `@bluecadet/launchpad-utils`. The default `TEvents` is `Record<string, unknown>`, so untyped usage works out of the box. Plugins and custom integrations can create typed event buses scoped to their own event contracts.

  Each plugin package exports its event types directly:

  - `ContentEvents` from `@bluecadet/launchpad-content`
  - `MonitorEvents` from `@bluecadet/launchpad-monitor`
  - `CoreEvents` from `@bluecadet/launchpad-utils`

- [#293](https://github.com/bluecadet/launchpad/pull/293) [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c) - Plugins can now declare CLI commands via `manifest.cli`. The hardcoded `content` and `monitor` CLI commands are removed — both plugins now declare their commands via their manifests. See the `@bluecadet/launchpad` changelog for migration details.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789) - Add Zod runtime validation for plugin commands.

  Content and monitor plugins now validate incoming commands against Zod schemas before processing. Invalid commands are rejected with a typed error at the plugin boundary rather than failing deep in business logic.

  `ContentCommandSchema` and `MonitorCommandSchema` are exported from their respective packages for use in custom integrations.

### Patch Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`1460cfd`](https://github.com/bluecadet/launchpad/commit/1460cfd8b762c851935ffe58679c68cfd29dd59f) - Fix orphaned promises in data store

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d) - Bump dependencies with vulnerabilities

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Adds persistent controller mode with a JSON-RPC 2.0 IPC interface.

  ### `launchpad start`

  A new `start` command launches the controller in persistent mode, opening an IPC socket so subsequent CLI commands connect to the running instance:

  ```bash
  launchpad start         # foreground
  launchpad start -d      # background (detached)
  ```

  ### IPC

  The CLI communicates with a running controller over a JSON-RPC 2.0 socket. The `IPCClient` API (`queryState()`, `executeCommand()`, `shutdown()`, event subscriptions) is the programmatic interface for this. A CLI and daemon must be on the same version.

  ### `LaunchpadConfig` moved to utils

  `LaunchpadConfig` moves from `@bluecadet/launchpad-cli` to `@bluecadet/launchpad-utils`, enabling declaration merging without a direct dependency on the CLI package.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`22c2428`](https://github.com/bluecadet/launchpad/commit/22c2428abe7a9f21ee66fcdcc108dba0dda5ce09) - Clear content data store when starting new fetch. Prevents stale content when refetching with persistent controller instance.

- Updated dependencies [[`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a), [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c), [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a)]:
  - @bluecadet/launchpad-utils@3.0.0

## 2.3.0

### Minor Changes

- [#239](https://github.com/bluecadet/launchpad/pull/239) [`308f7b9f970716f64e43ecb588ea8619785b8169`](https://github.com/bluecadet/launchpad/commit/308f7b9f970716f64e43ecb588ea8619785b8169) Thanks [@claytercek](https://github.com/claytercek)! - Send abortsignal to sources on content exit. Implemented for json, sanity, and strapi sources.

- [#237](https://github.com/bluecadet/launchpad/pull/237) [`391b5abb9c4af86226b10358e8ad5631c55476e8`](https://github.com/bluecadet/launchpad/commit/391b5abb9c4af86226b10358e8ad5631c55476e8) Thanks [@claytercek](https://github.com/claytercek)! - Support multiple paths in media downloader content plugin.

## 2.2.0

### Minor Changes

- [#235](https://github.com/bluecadet/launchpad/pull/235) [`d494f7a15a380502f47490045b6c96ae3da0ae14`](https://github.com/bluecadet/launchpad/commit/d494f7a15a380502f47490045b6c96ae3da0ae14) Thanks [@claytercek](https://github.com/claytercek)! - Pretty print JSON when saving to file.

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de) Thanks [@claytercek](https://github.com/claytercek)! - Support absolute or relative paths in launchpad config.

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc) Thanks [@claytercek](https://github.com/claytercek)! - Resolve all paths relative to the launchpad config directory when run from the CLI

- [#232](https://github.com/bluecadet/launchpad/pull/232) [`df1308167461c0b0b08af6b79a723035930e9f9a`](https://github.com/bluecadet/launchpad/commit/df1308167461c0b0b08af6b79a723035930e9f9a) Thanks [@claytercek](https://github.com/claytercek)! - Add symlink plugin

### Patch Changes

- Updated dependencies [[`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de), [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc)]:
  - @bluecadet/launchpad-utils@2.1.0

## 2.1.3

### Patch Changes

- [#228](https://github.com/bluecadet/launchpad/pull/228) [`9388a031ce03050445a4023b912559dcdcc41f9d`](https://github.com/bluecadet/launchpad/commit/9388a031ce03050445a4023b912559dcdcc41f9d) Thanks [@claytercek](https://github.com/claytercek)! - Fix broken async import for santyToMd plugin

## 2.1.2

### Patch Changes

- [#226](https://github.com/bluecadet/launchpad/pull/226) [`5441f0dae0913bfbd53cedb5cf4c3ea5b879e33b`](https://github.com/bluecadet/launchpad/commit/5441f0dae0913bfbd53cedb5cf4c3ea5b879e33b) Thanks [@claytercek](https://github.com/claytercek)! - Better optional dependency handling, with more descriptive error messages

## 2.1.1

### Patch Changes

- [#221](https://github.com/bluecadet/launchpad/pull/221) [`bd77ed9b28b080a326580fb018d6d7d76515e273`](https://github.com/bluecadet/launchpad/commit/bd77ed9b28b080a326580fb018d6d7d76515e273) Thanks [@claytercek](https://github.com/claytercek)! - media downloader: match images with url params by default

- [#221](https://github.com/bluecadet/launchpad/pull/221) [`f628fa9556e17b1c8d79334eff2001ae3035a13f`](https://github.com/bluecadet/launchpad/commit/f628fa9556e17b1c8d79334eff2001ae3035a13f) Thanks [@claytercek](https://github.com/claytercek)! - Fix progress bars wrapping on small terminals

- [#221](https://github.com/bluecadet/launchpad/pull/221) [`078f4ff7a484d584e37ecef10ee5a9eaebe13ded`](https://github.com/bluecadet/launchpad/commit/078f4ff7a484d584e37ecef10ee5a9eaebe13ded) Thanks [@claytercek](https://github.com/claytercek)! - Ensure all content plugins log on start and success.

- Updated dependencies [[`553bb964a52f6246d59f93ff72631cb963441dd5`](https://github.com/bluecadet/launchpad/commit/553bb964a52f6246d59f93ff72631cb963441dd5)]:
  - @bluecadet/launchpad-utils@2.0.1

## 2.1.0

### Minor Changes

- [#214](https://github.com/bluecadet/launchpad/pull/214) [`806fb9a1dcedc0e359bedba7d38a47b73d712b68`](https://github.com/bluecadet/launchpad/commit/806fb9a1dcedc0e359bedba7d38a47b73d712b68) Thanks [@claytercek](https://github.com/claytercek)! - Add support for ranged sanity queries (like `*[_type == "article"][0...100]` or `*[_type == "article"][0]`)

## 2.0.3

### Patch Changes

- [#206](https://github.com/bluecadet/launchpad/pull/206) [`babd99e1c76ec83c8003815f1c23653a7a122177`](https://github.com/bluecadet/launchpad/commit/babd99e1c76ec83c8003815f1c23653a7a122177) Thanks [@claytercek](https://github.com/claytercek)! - fix optional dependencies. Make them optional _peer_ dependencies instead.

## 2.0.2

### Patch Changes

- [#201](https://github.com/bluecadet/launchpad/pull/201) [`ca483809c70ecaa5d7cd407143303e0c5899b0d4`](https://github.com/bluecadet/launchpad/commit/ca483809c70ecaa5d7cd407143303e0c5899b0d4) Thanks [@claytercek](https://github.com/claytercek)! - Fix mediaDownloader plugin config type missing from d.ts

## 2.0.1

### Patch Changes

- [#196](https://github.com/bluecadet/launchpad/pull/196) [`d37489707a9814755828a0fca011c61823884617`](https://github.com/bluecadet/launchpad/commit/d37489707a9814755828a0fca011c61823884617) Thanks [@claytercek](https://github.com/claytercek)! - Fix content length check in media downloader

## 2.0.0

### Major Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989) Thanks [@claytercek](https://github.com/claytercek)! - **Plugin API and Content Package Updates:**

  - Add basic support for Plugin API across `content`, `monitor`, and `core` packages.
  - Implement full support for plugins in `content` package.
  - Refactor `content` sources to be functions.
  - Refactor `content` transforms and media-downloader to be plugins.
  - Implement `neverthrow` for error handling in `content` package.
  - Add unit tests for `content` package.
  - Fully remove credentials API (superseded by dotenv config)

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Minor Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`75622fbcf94d84717d6c1107799b5d745828a7a6`](https://github.com/bluecadet/launchpad/commit/75622fbcf94d84717d6c1107799b5d745828a7a6) Thanks [@claytercek](https://github.com/claytercek)! - update logging

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- [#188](https://github.com/bluecadet/launchpad/pull/188) [`aa37868b6135cafb2b89fae11b11d261f27ff6df`](https://github.com/bluecadet/launchpad/commit/aa37868b6135cafb2b89fae11b11d261f27ff6df) Thanks [@claytercek](https://github.com/claytercek)! - Update mediaDownloader and sanityImageUrlTransform defaults

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`5d5ead5bd77c97d69ed908cb00516d600708210a`](https://github.com/bluecadet/launchpad/commit/5d5ead5bd77c97d69ed908cb00516d600708210a) Thanks [@claytercek](https://github.com/claytercek)! - Fix content source/plugin exports

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`795eb39bcf9131615dd1e34c9c02933f8352f082`](https://github.com/bluecadet/launchpad/commit/795eb39bcf9131615dd1e34c9c02933f8352f082) Thanks [@claytercek](https://github.com/claytercek)! - Refactor DataStore to be a fs proxy instead of in memory

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- [#191](https://github.com/bluecadet/launchpad/pull/191) [`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1) Thanks [@claytercek](https://github.com/claytercek)! - More verbose error logging, plus better messages on source configs with unions

- [#189](https://github.com/bluecadet/launchpad/pull/189) [`6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02`](https://github.com/bluecadet/launchpad/commit/6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02) Thanks [@claytercek](https://github.com/claytercek)! - Improve contentful source compatibility with mediaDownloader

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`afbf13e74bebfdc788876292685bce374f8c42e2`](https://github.com/bluecadet/launchpad/commit/afbf13e74bebfdc788876292685bce374f8c42e2) Thanks [@claytercek](https://github.com/claytercek)! - fix media getting overwritten

- Updated dependencies [[`9252b2489f1e7170223c2c2bfaffe2202d32b59a`](https://github.com/bluecadet/launchpad/commit/9252b2489f1e7170223c2c2bfaffe2202d32b59a), [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935), [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989), [`75622fbcf94d84717d6c1107799b5d745828a7a6`](https://github.com/bluecadet/launchpad/commit/75622fbcf94d84717d6c1107799b5d745828a7a6), [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0), [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef), [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741), [`2c2866a77482a18759a4fdacafcb7e6493db6dbb`](https://github.com/bluecadet/launchpad/commit/2c2866a77482a18759a4fdacafcb7e6493db6dbb), [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1)]:
  - @bluecadet/launchpad-utils@2.0.0

## 2.0.0-next.8

### Patch Changes

- [#191](https://github.com/bluecadet/launchpad/pull/191) [`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1) Thanks [@claytercek](https://github.com/claytercek)! - More verbose error logging, plus better messages on source configs with unions

## 2.0.0-next.7

### Minor Changes

- [#188](https://github.com/bluecadet/launchpad/pull/188) [`aa37868b6135cafb2b89fae11b11d261f27ff6df`](https://github.com/bluecadet/launchpad/commit/aa37868b6135cafb2b89fae11b11d261f27ff6df) Thanks [@claytercek](https://github.com/claytercek)! - Update mediaDownloader and sanityImageUrlTransform defaults

### Patch Changes

- [#189](https://github.com/bluecadet/launchpad/pull/189) [`6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02`](https://github.com/bluecadet/launchpad/commit/6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02) Thanks [@claytercek](https://github.com/claytercek)! - Improve contentful source compatibility with mediaDownloader

## 2.0.0-next.6

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- Updated dependencies [[`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935)]:
  - @bluecadet/launchpad-utils@2.0.0-next.5

## 2.0.0-next.5

### Minor Changes

- [#178](https://github.com/bluecadet/launchpad/pull/178) [`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

### Patch Changes

- Updated dependencies [[`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758), [`a6f330947de66ba5b95abdf06f66ecfaca67bd0a`](https://github.com/bluecadet/launchpad/commit/a6f330947de66ba5b95abdf06f66ecfaca67bd0a)]:
  - @bluecadet/launchpad-utils@2.0.0-next.4

## 2.0.0-next.4

### Minor Changes

- [#176](https://github.com/bluecadet/launchpad/pull/176) [`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e) Thanks [@claytercek](https://github.com/claytercek)! - update logging

- [#174](https://github.com/bluecadet/launchpad/pull/174) [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

### Patch Changes

- Updated dependencies [[`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e), [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.3

## 2.0.0-next.3

### Minor Changes

- [#172](https://github.com/bluecadet/launchpad/pull/172) [`5e5ae3227b5fea9ac26db74c7c2f9859312c4021`](https://github.com/bluecadet/launchpad/commit/5e5ae3227b5fea9ac26db74c7c2f9859312c4021) Thanks [@claytercek](https://github.com/claytercek)! - Refactor DataStore to be a fs proxy instead of in memory

## 2.0.0-next.2

### Patch Changes

- [#170](https://github.com/bluecadet/launchpad/pull/170) [`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- [#171](https://github.com/bluecadet/launchpad/pull/171) [`f60543df8c24dbb2043940ce1fec52ac09036735`](https://github.com/bluecadet/launchpad/commit/f60543df8c24dbb2043940ce1fec52ac09036735) Thanks [@github-actions](https://github.com/apps/github-actions)! - fix media getting overwritten

- Updated dependencies [[`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.2

## 2.0.0-next.1

### Minor Changes

- [#166](https://github.com/bluecadet/launchpad/pull/166) [`a37a24093cedce25982a1245a78144b66c83e98a`](https://github.com/bluecadet/launchpad/commit/a37a24093cedce25982a1245a78144b66c83e98a) Thanks [@claytercek](https://github.com/claytercek)! - Fix content source/plugin exports

### Patch Changes

- Updated dependencies [[`a1b057ee1f19aa61541da91715a21753583828d5`](https://github.com/bluecadet/launchpad/commit/a1b057ee1f19aa61541da91715a21753583828d5)]:
  - @bluecadet/launchpad-utils@2.0.0-next.1

## 2.0.0-next.0

### Major Changes

- [#164](https://github.com/bluecadet/launchpad/pull/164) [`3d40d3c3f47afe080f642b3188f5e62a529a891b`](https://github.com/bluecadet/launchpad/commit/3d40d3c3f47afe080f642b3188f5e62a529a891b) Thanks [@github-actions](https://github.com/apps/github-actions)! - **Plugin API and Content Package Updates:**

  - Add basic support for Plugin API across `content`, `monitor`, and `core` packages.
  - Implement full support for plugins in `content` package.
  - Refactor `content` sources to be functions.
  - Refactor `content` transforms and media-downloader to be plugins.
  - Implement `neverthrow` for error handling in `content` package.
  - Add unit tests for `content` package.
  - Fully remove credentials API (superseded by dotenv config)

- [#165](https://github.com/bluecadet/launchpad/pull/165) [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Patch Changes

- Updated dependencies [[`3d40d3c3f47afe080f642b3188f5e62a529a891b`](https://github.com/bluecadet/launchpad/commit/3d40d3c3f47afe080f642b3188f5e62a529a891b), [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de)]:
  - @bluecadet/launchpad-utils@2.0.0-next.0

## 1.14.1

### Patch Changes

- [#158](https://github.com/bluecadet/launchpad/pull/158) [`a331bfed02f2ede745c3c54da8fdb3c57537e404`](https://github.com/bluecadet/launchpad/commit/a331bfed02f2ede745c3c54da8fdb3c57537e404) Thanks [@claytercek](https://github.com/claytercek)! - add maxTimeout property to json source config

## 1.14.0

### Minor Changes

- [`4bafb91969f7768b00f8ed353eb7b86b611dff9e`](https://github.com/bluecadet/launchpad/commit/4bafb91969f7768b00f8ed353eb7b86b611dff9e) Thanks [@claytercek](https://github.com/claytercek)! - Add more control over how `launchpad content` encodes URL characters when writing to disk. Added new `encodeChars` option to content options.

## 1.13.1

### Patch Changes

- [#153](https://github.com/bluecadet/launchpad/pull/153) [`ae7bd38cbc16d404902db90e615ec897af1b5e6d`](https://github.com/bluecadet/launchpad/commit/ae7bd38cbc16d404902db90e615ec897af1b5e6d) Thanks [@claytercek](https://github.com/claytercek)! - Fix event warning in media downloader. Also switch from `got` to `ky` for fetching (recommended by maintainers).

- [#153](https://github.com/bluecadet/launchpad/pull/153) [`ae7bd38cbc16d404902db90e615ec897af1b5e6d`](https://github.com/bluecadet/launchpad/commit/ae7bd38cbc16d404902db90e615ec897af1b5e6d) Thanks [@claytercek](https://github.com/claytercek)! - Update default backup path to avoid polluting the launchpad directory with empty timestamp folders

## 1.13.0

### Minor Changes

- [`b7fa754826aa9201da0f02ed864ecde2cbb1ed1b`](https://github.com/bluecadet/launchpad/commit/b7fa754826aa9201da0f02ed864ecde2cbb1ed1b) Thanks [@claytercek](https://github.com/claytercek)! - Include URL query strings for default media download paths

## 1.12.4

### Patch Changes

- [#150](https://github.com/bluecadet/launchpad/pull/150) [`30ddcffdeaa045c7f19b80d454eebdbbe6a978df`](https://github.com/bluecadet/launchpad/commit/30ddcffdeaa045c7f19b80d454eebdbbe6a978df) Thanks [@github-actions](https://github.com/apps/github-actions)! - Abort content downloads on exit

- [`6e214aa9dd6a847a7bc1558a35f1153f976bb1d4`](https://github.com/bluecadet/launchpad/commit/6e214aa9dd6a847a7bc1558a35f1153f976bb1d4) Thanks [@claytercek](https://github.com/claytercek)! - Fix inconsistent deletion of temp/backup directories

## 1.12.3

### Patch Changes

- [`8f3511870ee290678e8b987f75ac9f39929cfba0`](https://github.com/bluecadet/launchpad/commit/8f3511870ee290678e8b987f75ac9f39929cfba0) Thanks [@claytercek](https://github.com/claytercek)! - oops. _Actually_ fix ignoreImageTransformErrors flag

## 1.12.2

### Patch Changes

- [#146](https://github.com/bluecadet/launchpad/pull/146) [`c203bda5812f3573dde4fdc4a000002b4e747325`](https://github.com/bluecadet/launchpad/commit/c203bda5812f3573dde4fdc4a000002b4e747325) Thanks [@claytercek](https://github.com/claytercek)! - Fix json content source media URL scraping

## 1.12.1

### Patch Changes

- [#139](https://github.com/bluecadet/launchpad/pull/139) [`8d894c360d13a11fe662e2378be0ef644602dfe9`](https://github.com/bluecadet/launchpad/commit/8d894c360d13a11fe662e2378be0ef644602dfe9) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Upgrade sharp dependency

## 1.12.0

### Minor Changes

- [#128](https://github.com/bluecadet/launchpad/pull/128) [`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72) Thanks [@claytercek](https://github.com/claytercek)! - Add intellisense support to configs

- [#124](https://github.com/bluecadet/launchpad/pull/124) [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd) Thanks [@claytercek](https://github.com/claytercek)! - support js configs

- [#133](https://github.com/bluecadet/launchpad/pull/133) [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1) Thanks [@claytercek](https://github.com/claytercek)! - Load dotenv files when launching from CLI

### Patch Changes

- [#118](https://github.com/bluecadet/launchpad/pull/118) [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa) Thanks [@claytercek](https://github.com/claytercek)! - Generate d.ts declaration files for intellisense, and fix all type errors.

- Updated dependencies [[`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72), [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd), [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1), [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa)]:
  - @bluecadet/launchpad-utils@1.5.0

## 1.11.0

### Minor Changes

- [#111](https://github.com/bluecadet/launchpad/pull/111) [`6502ded`](https://github.com/bluecadet/launchpad/commit/6502ded3105bd803d38978758d4c3794fc54cd8c) Thanks [@claytercek](https://github.com/claytercek)! - add support for strapi v4

## 1.10.2

### Patch Changes

- [#109](https://github.com/bluecadet/launchpad/pull/109) [`33e6488`](https://github.com/bluecadet/launchpad/commit/33e648884e44ed42be5d600e1a2a9f8c183d1a3c) Thanks [@claytercek](https://github.com/claytercek)! - update `@portabletext/to-html` dependency to fix launchpad content syntax error

## 1.10.1

### Patch Changes

- [`0a62a90`](https://github.com/bluecadet/launchpad/commit/0a62a9083b80eec5587c3ea5c465672c2e041282) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

## 1.10.0

### Minor Changes

- [#98](https://github.com/bluecadet/launchpad/pull/98) [`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added eslint and reformated code

### Patch Changes

- Updated dependencies [[`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee)]:
  - @bluecadet/launchpad-utils@1.4.0

## 1.9.0

### Minor Changes

- [#80](https://github.com/bluecadet/launchpad/pull/80) [`c911be2`](https://github.com/bluecadet/launchpad/commit/c911be2b406d8ff9d6fbc7d17d16af24af26f58a) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Fixed sanity image crop downloads. Added appendCroppedFilenames option

## 1.8.1

### Patch Changes

- [`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

- Updated dependencies [[`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3)]:
  - @bluecadet/launchpad-utils@1.3.1

## 1.8.0

### Minor Changes

- [#68](https://github.com/bluecadet/launchpad/pull/68) [`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

### Patch Changes

- Updated dependencies [[`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3)]:
  - @bluecadet/launchpad-utils@1.3.0

## 1.7.0

### Minor Changes

- [`f3c7916`](https://github.com/bluecadet/launchpad/commit/f3c79169001dd157c7e3bce24da41409a3906d53) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Simplified json url parsing for better efficiency with large files

## 1.6.0

### Minor Changes

- [#62](https://github.com/bluecadet/launchpad/pull/62) [`a4132da`](https://github.com/bluecadet/launchpad/commit/a4132da0187f669ad95251e2f3903229e87d6123) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added caching and blur to image transforms

## 1.5.0

### Minor Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

### Patch Changes

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1

## 1.5.0-next.0

### Minor Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

### Patch Changes

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1-next.0

## 1.4.0

### Minor Changes

- [#47](https://github.com/bluecadet/launchpad/pull/47) [`7f93181`](https://github.com/bluecadet/launchpad/commit/7f9318171c7d44ef812243454608d75810895d14) Thanks [@pingevt](https://github.com/pingevt)! - Updating Sanity source

  Changes config for custom Queries
  Adds an option for saving data in multiple files or in one file

### Patch Changes

- [#47](https://github.com/bluecadet/launchpad/pull/47) [`c9a66e1`](https://github.com/bluecadet/launchpad/commit/c9a66e1416d49c1447d010ab08b3de9c45b4e0a0) Thanks [@pingevt](https://github.com/pingevt)! - Add in better checking to process Sanity Text Blocks

## 1.3.0

### Minor Changes

- [#39](https://github.com/bluecadet/launchpad/pull/39) [`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23) Thanks [@github-actions](https://github.com/apps/github-actions)! - Changeset monorepo restructure

### Patch Changes

- Updated dependencies [[`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23)]:
  - @bluecadet/launchpad-utils@1.2.0

## 1.2.0

### Minor Changes

- [#28](https://github.com/bluecadet/launchpad/pull/28) [`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Start using [🦋 Changesets](https://github.com/changesets/changesets) to manage releases.

### Patch Changes

- Updated dependencies [[`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc)]:
  - @bluecadet/launchpad-utils@1.1.0
