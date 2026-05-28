# @bluecadet/launchpad-monitor

## 3.0.2

### Patch Changes

- [#299](https://github.com/bluecadet/launchpad/pull/299) [`221eb24`](https://github.com/bluecadet/launchpad/commit/221eb2468c0f9bf81727fc9dd81c64b405e5be44) - Fix monitored apps not being stopped when Launchpad exits via SIGINT/SIGTERM. The monitor plugin's `disconnect()` hook now calls `shutdown()` (stop apps + disconnect) instead of only disconnecting from PM2.

## 3.0.1

### Patch Changes

- [#294](https://github.com/bluecadet/launchpad/pull/294) [`f595316`](https://github.com/bluecadet/launchpad/commit/f5953169d00e1890a81c79e26466078e88aa8ae3) - capture pm2 errors thrown on startup instead of ignoring

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

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789) - Add Zod runtime validation for plugin commands.

  Content and monitor plugins now validate incoming commands against Zod schemas before processing. Invalid commands are rejected with a typed error at the plugin boundary rather than failing deep in business logic.

  `ContentCommandSchema` and `MonitorCommandSchema` are exported from their respective packages for use in custom integrations.

### Patch Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`41f432d`](https://github.com/bluecadet/launchpad/commit/41f432d7c51bd1dce64868e002af2d1bd7bb4733) - Fix monitor shutdown not working properly.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d) - Bump dependencies with vulnerabilities

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789) - Remove `process.exit()` calls from library code.

  Library code should never terminate the host process. The monitor and IPC transport now emit a `system:shutdown` event on the event bus instead of calling `process.exit(0)` on graceful shutdown. The CLI handles this event and exits cleanly. Programmatic users of the monitor or controller who relied on the implicit exit should listen for `system:shutdown` instead.

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

- [#273](https://github.com/bluecadet/launchpad/pull/273) [`9061c4d`](https://github.com/bluecadet/launchpad/commit/9061c4d5b967b6973e364428998b4478f9f663bd) - Fix pm2 'ENOENT' bug

- Updated dependencies [[`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a), [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c), [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a)]:
  - @bluecadet/launchpad-utils@3.0.0

## 2.1.0

### Minor Changes

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de) Thanks [@claytercek](https://github.com/claytercek)! - Support absolute or relative paths in launchpad config.

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc) Thanks [@claytercek](https://github.com/claytercek)! - Resolve all paths relative to the launchpad config directory when run from the CLI

### Patch Changes

- Updated dependencies [[`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de), [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc)]:
  - @bluecadet/launchpad-utils@2.1.0

## 2.0.5

### Patch Changes

- [#225](https://github.com/bluecadet/launchpad/pull/225) [`7fee5651f3f98848cad96490b7dfd8ca3966aa92`](https://github.com/bluecadet/launchpad/commit/7fee5651f3f98848cad96490b7dfd8ca3966aa92) Thanks [@claytercek](https://github.com/claytercek)! - Fix debounceDelay for applying app windowing config

- [#225](https://github.com/bluecadet/launchpad/pull/225) [`2646bacc9dc4db4cc19b345a03d5384c70058811`](https://github.com/bluecadet/launchpad/commit/2646bacc9dc4db4cc19b345a03d5384c70058811) Thanks [@claytercek](https://github.com/claytercek)! - Hard code window reorder MIN_NODE_VERSION instead of making it configurable

## 2.0.4

### Patch Changes

- [`25f4d25155c3214682c1bfc9514f2de97352c32e`](https://github.com/bluecadet/launchpad/commit/25f4d25155c3214682c1bfc9514f2de97352c32e) Thanks [@claytercek](https://github.com/claytercek)! - Fix window settings not applying correctly

## 2.0.3

### Patch Changes

- [#219](https://github.com/bluecadet/launchpad/pull/219) [`39f1033792dd96468311c45ddedc722dd46f8fc6`](https://github.com/bluecadet/launchpad/commit/39f1033792dd96468311c45ddedc722dd46f8fc6) Thanks [@claytercek](https://github.com/claytercek)! - Fix app logging

- [#219](https://github.com/bluecadet/launchpad/pull/219) [`6d87825407cd3df23ae7e146d279e2bc37954421`](https://github.com/bluecadet/launchpad/commit/6d87825407cd3df23ae7e146d279e2bc37954421) Thanks [@claytercek](https://github.com/claytercek)! - Fix PM2 app hiding

## 2.0.2

### Patch Changes

- [#217](https://github.com/bluecadet/launchpad/pull/217) [`afbe6093f444c5cf2669fa58b4c557638f6aefe7`](https://github.com/bluecadet/launchpad/commit/afbe6093f444c5cf2669fa58b4c557638f6aefe7) Thanks [@claytercek](https://github.com/claytercek)! - Upgrade PM2, fix broken pm2 calls.

## 2.0.1

### Patch Changes

- [#208](https://github.com/bluecadet/launchpad/pull/208) [`710c05e16edd27ea40c32268351555fb10ed1639`](https://github.com/bluecadet/launchpad/commit/710c05e16edd27ea40c32268351555fb10ed1639) Thanks [@claytercek](https://github.com/claytercek)! - fix monitor pm2 passthrough types

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

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`9252b2489f1e7170223c2c2bfaffe2202d32b59a`](https://github.com/bluecadet/launchpad/commit/9252b2489f1e7170223c2c2bfaffe2202d32b59a), [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935), [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989), [`75622fbcf94d84717d6c1107799b5d745828a7a6`](https://github.com/bluecadet/launchpad/commit/75622fbcf94d84717d6c1107799b5d745828a7a6), [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0), [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef), [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741), [`2c2866a77482a18759a4fdacafcb7e6493db6dbb`](https://github.com/bluecadet/launchpad/commit/2c2866a77482a18759a4fdacafcb7e6493db6dbb), [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1)]:
  - @bluecadet/launchpad-utils@2.0.0

## 2.0.0-next.4

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- Updated dependencies [[`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935)]:
  - @bluecadet/launchpad-utils@2.0.0-next.5

## 2.0.0-next.3

### Minor Changes

- [#174](https://github.com/bluecadet/launchpad/pull/174) [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

### Patch Changes

- Updated dependencies [[`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e), [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.3

## 2.0.0-next.2

### Patch Changes

- [#170](https://github.com/bluecadet/launchpad/pull/170) [`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.2

## 2.0.0-next.1

### Major Changes

- [#168](https://github.com/bluecadet/launchpad/pull/168) [`a1b057ee1f19aa61541da91715a21753583828d5`](https://github.com/bluecadet/launchpad/commit/a1b057ee1f19aa61541da91715a21753583828d5) Thanks [@claytercek](https://github.com/claytercek)! - **Plugin API and Monitor Package Updates:**
  - Refactor `monitor` package to use `neverthrow` for error handling.
  - Add tests for `monitor` package.
  - Add hooks for `monitor` events.
  - Add tests to `utils` package.

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

## 1.8.0

### Minor Changes

- [#128](https://github.com/bluecadet/launchpad/pull/128) [`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72) Thanks [@claytercek](https://github.com/claytercek)! - Add intellisense support to configs

- [#124](https://github.com/bluecadet/launchpad/pull/124) [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd) Thanks [@claytercek](https://github.com/claytercek)! - support js configs

- [#133](https://github.com/bluecadet/launchpad/pull/133) [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1) Thanks [@claytercek](https://github.com/claytercek)! - Load dotenv files when launching from CLI

### Patch Changes

- [#118](https://github.com/bluecadet/launchpad/pull/118) [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa) Thanks [@claytercek](https://github.com/claytercek)! - Generate d.ts declaration files for intellisense, and fix all type errors.

- Updated dependencies [[`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72), [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd), [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1), [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa)]:
  - @bluecadet/launchpad-utils@1.5.0

## 1.7.0

### Minor Changes

- [#98](https://github.com/bluecadet/launchpad/pull/98) [`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added eslint and reformated code

### Patch Changes

- Updated dependencies [[`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee)]:
  - @bluecadet/launchpad-utils@1.4.0

## 1.6.0

### Minor Changes

- [#90](https://github.com/bluecadet/launchpad/pull/90) [`56a0a60`](https://github.com/bluecadet/launchpad/commit/56a0a60d88671d788a90eb80c5d0b37187879158) Thanks [@claytercek](https://github.com/claytercek)! - connect to pm2 using `no-daemon-mode`, and route console method calls to the parent logger

### Patch Changes

- Updated dependencies [[`56a0a60`](https://github.com/bluecadet/launchpad/commit/56a0a60d88671d788a90eb80c5d0b37187879158)]:
  - @bluecadet/launchpad-utils@1.3.2

## 1.5.0

### Minor Changes

- [#88](https://github.com/bluecadet/launchpad/pull/88) [`31282d1`](https://github.com/bluecadet/launchpad/commit/31282d1bbf122e1eb989bdba3c2baa77053e7edc) Thanks [@claytercek](https://github.com/claytercek)! - better support for log rotation by updating default configs and making tail functionality opt-in

## 1.4.0

### Minor Changes

- [#82](https://github.com/bluecadet/launchpad/pull/82) [`f1ceb41`](https://github.com/bluecadet/launchpad/commit/f1ceb41c61d7eb8cce48d3ae2c81e39dd341e84c) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Swapped window management engine for fewer dependencies. Removed 'fake key' setting.

## 1.3.1

### Patch Changes

- [`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

- Updated dependencies [[`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3)]:
  - @bluecadet/launchpad-utils@1.3.1

## 1.3.0

### Minor Changes

- [#68](https://github.com/bluecadet/launchpad/pull/68) [`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

### Patch Changes

- Updated dependencies [[`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3)]:
  - @bluecadet/launchpad-utils@1.3.0

## 1.2.1

### Patch Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1

## 1.2.1-next.0

### Patch Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-utils@1.2.1-next.0

## 1.2.0

### Minor Changes

- [#39](https://github.com/bluecadet/launchpad/pull/39) [`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23) Thanks [@github-actions](https://github.com/apps/github-actions)! - Changeset monorepo restructure

### Patch Changes

- Updated dependencies [[`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23)]:
  - @bluecadet/launchpad-utils@1.2.0

## 1.1.0

### Minor Changes

- [#28](https://github.com/bluecadet/launchpad/pull/28) [`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Start using [🦋 Changesets](https://github.com/changesets/changesets) to manage releases.

### Patch Changes

- Updated dependencies [[`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc)]:
  - @bluecadet/launchpad-utils@1.1.0
