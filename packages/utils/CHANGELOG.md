# @bluecadet/launchpad-utils

## 3.1.0

### Minor Changes

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`53fb2fc`](https://github.com/bluecadet/launchpad/commit/53fb2fc74cecd47b33585618a6b39d875d308b02) - Add `duration` and `status-format` entry points as the canonical home for duration parsing and status-row time formatting, replacing the near-duplicate implementations scattered across `@bluecadet/launchpad-scheduler` and `@bluecadet/launchpad-content`. `duration` exports `parseDuration` (null-returning) and a `durationSchema`/`Duration` zod pair. `status-format` exports `formatDurationMs`, `formatTimeAgo`, `formatTimeUntil`, and `formatClockTime` for rendering `Row`/`Section` status entries.

### Patch Changes

- [#309](https://github.com/bluecadet/launchpad/pull/309) [`13cfbe6`](https://github.com/bluecadet/launchpad/commit/13cfbe6ce9bb9efb7a3a3d5d16080538af040acf) - Fix `PatchedStateManager.updateState` letting a throwing patch subscriber unwind into the code that produced the state update and skip the remaining subscribers. Handlers are now invoked with the same catch-and-log isolation as `EventBus` handlers.

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`3665436`](https://github.com/bluecadet/launchpad/commit/3665436402021470f2e9654e81fa978a8fe4daff) - Fix `EventBus.emit` letting a throwing `on()` listener escape into the caller's control flow (e.g. rejecting a neverthrow pipeline mid-flight and crashing the process via an unhandled rejection). Regular listeners are now invoked individually with the same catch-and-log isolation already used for `onAny` wildcard handlers, so one throwing listener no longer stops later listeners from running.

## 3.0.0

### Major Changes

- [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2) - Replaces the hook-based plugin system with a unified plugin model across all packages. See the `@bluecadet/launchpad` changelog for migration details.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Introduces `StatusSnapshot` and `ctx.updateState()` for plugin status and state management. See the `@bluecadet/launchpad` changelog for migration details.

### Minor Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789) - Introduce `EventBus<TEvents>` and per-package event types.

  `EventBus<TEvents extends Record<string, unknown>>` is available from `@bluecadet/launchpad-utils`. The default `TEvents` is `Record<string, unknown>`, so untyped usage works out of the box. Plugins and custom integrations can create typed event buses scoped to their own event contracts.

  Each plugin package exports its event types directly:

  - `ContentEvents` from `@bluecadet/launchpad-content`
  - `MonitorEvents` from `@bluecadet/launchpad-monitor`
  - `CoreEvents` from `@bluecadet/launchpad-utils`

- [#293](https://github.com/bluecadet/launchpad/pull/293) [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c) - Plugins can now declare CLI commands via `manifest.cli`. The hardcoded `content` and `monitor` CLI commands are removed — both plugins now declare their commands via their manifests. See the `@bluecadet/launchpad` changelog for migration details.

### Patch Changes

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

## 2.1.0

### Minor Changes

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de) Thanks [@claytercek](https://github.com/claytercek)! - Support absolute or relative paths in launchpad config.

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc) Thanks [@claytercek](https://github.com/claytercek)! - Resolve all paths relative to the launchpad config directory when run from the CLI

## 2.0.1

### Patch Changes

- [#221](https://github.com/bluecadet/launchpad/pull/221) [`553bb964a52f6246d59f93ff72631cb963441dd5`](https://github.com/bluecadet/launchpad/commit/553bb964a52f6246d59f93ff72631cb963441dd5) Thanks [@claytercek](https://github.com/claytercek)! - Fix CLI flicker for fixed log items

## 2.0.0

### Major Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`9252b2489f1e7170223c2c2bfaffe2202d32b59a`](https://github.com/bluecadet/launchpad/commit/9252b2489f1e7170223c2c2bfaffe2202d32b59a) Thanks [@claytercek](https://github.com/claytercek)! - **Plugin API and Monitor Package Updates:**

  - Refactor `monitor` package to use `neverthrow` for error handling.
  - Add tests for `monitor` package.
  - Add hooks for `monitor` events.
  - Add tests to `utils` package.

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

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`2c2866a77482a18759a4fdacafcb7e6493db6dbb`](https://github.com/bluecadet/launchpad/commit/2c2866a77482a18759a4fdacafcb7e6493db6dbb) Thanks [@claytercek](https://github.com/claytercek)! - cleanup file and console log formats

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

## 2.0.0-next.5

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

## 2.0.0-next.4

### Minor Changes

- [#177](https://github.com/bluecadet/launchpad/pull/177) [`a6f330947de66ba5b95abdf06f66ecfaca67bd0a`](https://github.com/bluecadet/launchpad/commit/a6f330947de66ba5b95abdf06f66ecfaca67bd0a) Thanks [@github-actions](https://github.com/apps/github-actions)! - cleanup file and console log formats

### Patch Changes

- [#178](https://github.com/bluecadet/launchpad/pull/178) [`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

## 2.0.0-next.3

### Minor Changes

- [#176](https://github.com/bluecadet/launchpad/pull/176) [`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e) Thanks [@claytercek](https://github.com/claytercek)! - update logging

- [#174](https://github.com/bluecadet/launchpad/pull/174) [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

## 2.0.0-next.2

### Patch Changes

- [#170](https://github.com/bluecadet/launchpad/pull/170) [`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

## 2.0.0-next.1

### Major Changes

- [#168](https://github.com/bluecadet/launchpad/pull/168) [`a1b057ee1f19aa61541da91715a21753583828d5`](https://github.com/bluecadet/launchpad/commit/a1b057ee1f19aa61541da91715a21753583828d5) Thanks [@claytercek](https://github.com/claytercek)! - **Plugin API and Monitor Package Updates:**
  - Refactor `monitor` package to use `neverthrow` for error handling.
  - Add tests for `monitor` package.
  - Add hooks for `monitor` events.
  - Add tests to `utils` package.

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

## 1.5.2

### Patch Changes

- [`b5ad10209390eb583f3bb97934bc2927a056d003`](https://github.com/bluecadet/launchpad/commit/b5ad10209390eb583f3bb97934bc2927a056d003) Thanks [@claytercek](https://github.com/claytercek)! - fix ignoreImageTransformErrors flag

## 1.5.1

### Patch Changes

- [#136](https://github.com/bluecadet/launchpad/pull/136) [`33623e5`](https://github.com/bluecadet/launchpad/commit/33623e5dc8da9714fc91449de60a08fb4f2a0fa0) Thanks [@claytercek](https://github.com/claytercek)! - fix loading js configs on windows

## 1.5.0

### Minor Changes

- [#128](https://github.com/bluecadet/launchpad/pull/128) [`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72) Thanks [@claytercek](https://github.com/claytercek)! - Add intellisense support to configs

- [#124](https://github.com/bluecadet/launchpad/pull/124) [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd) Thanks [@claytercek](https://github.com/claytercek)! - support js configs

- [#133](https://github.com/bluecadet/launchpad/pull/133) [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1) Thanks [@claytercek](https://github.com/claytercek)! - Load dotenv files when launching from CLI

### Patch Changes

- [#118](https://github.com/bluecadet/launchpad/pull/118) [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa) Thanks [@claytercek](https://github.com/claytercek)! - Generate d.ts declaration files for intellisense, and fix all type errors.

## 1.4.0

### Minor Changes

- [#98](https://github.com/bluecadet/launchpad/pull/98) [`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added eslint and reformated code

## 1.3.2

### Patch Changes

- [#90](https://github.com/bluecadet/launchpad/pull/90) [`56a0a60`](https://github.com/bluecadet/launchpad/commit/56a0a60d88671d788a90eb80c5d0b37187879158) Thanks [@claytercek](https://github.com/claytercek)! - connect to pm2 using `no-daemon-mode`, and route console method calls to the parent logger

## 1.3.1

### Patch Changes

- [`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

## 1.3.0

### Minor Changes

- [#68](https://github.com/bluecadet/launchpad/pull/68) [`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

## 1.2.1

### Patch Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

## 1.2.1-next.0

### Patch Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

## 1.2.0

### Minor Changes

- [#39](https://github.com/bluecadet/launchpad/pull/39) [`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23) Thanks [@github-actions](https://github.com/apps/github-actions)! - Changeset monorepo restructure

## 1.1.0

### Minor Changes

- [#28](https://github.com/bluecadet/launchpad/pull/28) [`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Start using [🦋 Changesets](https://github.com/changesets/changesets) to manage releases.
