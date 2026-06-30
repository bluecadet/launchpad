# @bluecadet/launchpad

## 3.0.4

### Patch Changes

- Updated dependencies [[`f03604e`](https://github.com/bluecadet/launchpad/commit/f03604ecfaa2675dcf6333f73c912733a9fb6d97), [`9b1eeeb`](https://github.com/bluecadet/launchpad/commit/9b1eeebfa6757d136fbc3987ee809c80ab6972e9), [`109f9fb`](https://github.com/bluecadet/launchpad/commit/109f9fbffbf16de715eaa87635138ebeb64986d2)]:
  - @bluecadet/launchpad-controller@3.1.0
  - @bluecadet/launchpad-cli@3.0.3

## 3.0.3

### Patch Changes

- Updated dependencies [[`10e105d`](https://github.com/bluecadet/launchpad/commit/10e105d4c2d1102c846e5585a714b3e09fd1c147), [`221eb24`](https://github.com/bluecadet/launchpad/commit/221eb2468c0f9bf81727fc9dd81c64b405e5be44)]:
  - @bluecadet/launchpad-controller@3.0.1
  - @bluecadet/launchpad-monitor@3.0.2

## 3.0.2

### Patch Changes

- Updated dependencies [[`3d0863c`](https://github.com/bluecadet/launchpad/commit/3d0863c53a08a897d45b8516bb25eed119063a8e)]:
  - @bluecadet/launchpad-cli@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [[`f595316`](https://github.com/bluecadet/launchpad/commit/f5953169d00e1890a81c79e26466078e88aa8ae3), [`4396230`](https://github.com/bluecadet/launchpad/commit/4396230cdeba0a2c745a71bade43d3e83656c372), [`c1f791a`](https://github.com/bluecadet/launchpad/commit/c1f791a2c884fdd15ab8eed3e47949b999d879b9)]:
  - @bluecadet/launchpad-monitor@3.0.1
  - @bluecadet/launchpad-observability@3.0.0
  - @bluecadet/launchpad-cli@3.0.1

## 3.0.0

### Major Changes

- [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2) - Breaking changes to the content fetch pipeline, path helpers, and file path defaults.

  ### Fetch API

  `LaunchpadContent` gains a `loadSources()` method. `fetch()` and `clear()` now accept source IDs (strings) instead of full source objects:

  ```ts
  // Before
  content.fetch(sourceObjects);

  // After
  content.fetch(sourceIds);
  ```

  ### Staged promotion model

  Fetches no longer write directly to `downloadPath`. Instead, each run stages output under an isolated directory inside `tempPath`, then atomically promotes it into the published `downloadPath` only after every source and transform succeeds:

  1. A fresh staged output tree is prepared under `tempPath/runs/<runId>/downloads/`.
  2. Files from the currently published `downloadPath` that match `keep` rules are copied into staging.
  3. Sources and transforms write into the staged tree only.
  4. On success, the staged tree is promoted into `downloadPath`.
  5. On failure, the staged tree is discarded and the previously published `downloadPath` is left unchanged.

  This means failed fetches no longer corrupt published content without requiring `backupAndRestore`. Backup is still available as an extra safety net but is no longer the primary rollback mechanism.

  **Breaking for custom transforms**: `paths.getDownloadPath()` now returns the staged run path, not the published path. If you need to read currently published files, use the new `paths.getPublishedDownloadPath()`. Do not write to the published path during a fetch run.

  New path helper methods: `getPublishedDownloadPath()`, `getStagedDownloadPath()`, `getRunPath()`.

  ### Default file paths

  Default `tempPath` changes from `.tmp/` to `.launchpad/tmp/`. Tokenization logic is removed from all path generation — backup, download, and temp paths are no longer namespaced by token.

- [#283](https://github.com/bluecadet/launchpad/pull/283) [`73e0d1e`](https://github.com/bluecadet/launchpad/commit/73e0d1e52d623c82fb86488bce35b31e54f8fec8) - Remove the `scaffold` package and `launchpad scaffold` CLI command. Windows kiosk and exhibit machine configuration is now handled by [Preflight](https://github.com/bluecadet/preflight), a dedicated tool by Bluecadet.

  **Migration**: If you relied on `launchpad scaffold` or `@bluecadet/launchpad/scaffold`, switch to [Preflight](https://github.com/bluecadet/preflight).

- [#293](https://github.com/bluecadet/launchpad/pull/293) [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c) - Plugins can now declare CLI commands in their manifest. The hardcoded `content` and `monitor` CLI commands are removed and replaced with manifest declarations inside their respective plugins.

  ### Plugin-declared CLI commands

  Third-party plugins can expose CLI commands by adding a `cli` field to their `PluginManifest`. The CLI loads plugin manifests at startup and registers declared commands as yargs commands — no CLI package changes needed.

  ```ts
  definePlugin({
    name: "my-plugin",
    manifest: {
      commands: [{ id: "my-plugin.sync" }],
      cli: [
        {
          name: "sync",
          description: "Sync data",
          commands: [{ type: "my-plugin.sync" }],
          flags: {
            force: {
              type: "boolean",
              alias: "f",
              description: "Force re-sync",
            },
          },
        },
      ],
    },
    // ...
  });
  ```

  ```bash
  launchpad sync           # dispatches my-plugin.sync
  launchpad sync --force   # dispatches { type: "my-plugin.sync", force: true }
  ```

  Leaf commands support `flags` (typed options with `boolean`, `string`, or `number` types, including array flags) and `positionals` (ordered arguments, including variadic). Group commands nest subcommands under a parent name:

  ```ts
  cli: [
    {
      name: "monitor",
      subcommands: [
        { name: "start", mode: "persistent", commands: [{ type: "monitor.connect" }, { type: "monitor.start" }] },
        { name: "stop",  mode: "task",       commands: [{ type: "monitor.stop" }] },
      ],
    },
  ],
  ```

  The CLI exits with a descriptive error at startup if two plugins declare the same top-level command name. If the config file is missing or invalid, built-in commands (`start`, `stop`, `status`) remain available — plugin commands are silently absent.

  ### Breaking: `launchpad content` and `launchpad monitor` command changes

  ```bash
  # Before
  launchpad content         # fetch all content
  launchpad monitor         # start monitor (persistent)

  # After
  launchpad content fetch   # fetch all content
  launchpad monitor start   # start monitor (persistent)
  launchpad monitor stop    # stop monitor
  launchpad monitor restart # restart monitored apps
  ```

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Replaces the hook-based plugin system with a unified plugin model across all packages.

  ### Config shape

  The top-level `content` and `monitor` keys are replaced by a `plugins` array:

  ```ts
  // Before
  { content: { sources: [...] }, monitor: { apps: [...] } }

  // After
  import { content, monitor } from '@bluecadet/launchpad';
  { plugins: [content({ sources: [...] }), monitor({ apps: [...] })] }
  ```

  ### Renamed factory functions

  - `createLaunchpadContent` → `content` (`@bluecadet/launchpad-content`)
  - `createLaunchpadMonitor` → `monitor` (`@bluecadet/launchpad-monitor`)

  ### Content transforms

  The `plugins` config field is renamed to `transforms`, and `ContentPlugin` / `ContentPluginDriver` are replaced by `ContentTransform`:

  ```ts
  // Before
  {
    plugins: [sanityToHtml(), mediaDownloader()];
  }

  // After
  {
    transforms: [sanityToHtml(), mediaDownloader()];
  }
  ```

  Events renamed: `content:plugin:start/done/error` → `content:transform:start/done/error`; payload field `pluginName` → `transformName`.

  ### Monitor plugins removed

  The `plugins` config field and `MonitorPlugin` / `MonitorPluginDriver` types are removed. Previously, monitor plugins received lifecycle callbacks (`beforeConnect`, `afterConnect`, `beforeAppStart`, `afterAppStart`, `onAppLog`, etc.) invoked by the driver. All of those lifecycle moments — and more — are now emitted as typed events on the shared event bus:

  | Old hook                               | New event                                              |
  | -------------------------------------- | ------------------------------------------------------ |
  | `beforeConnect` / `afterConnect`       | `monitor:connect:start` / `monitor:connect:done`       |
  | `beforeDisconnect` / `afterDisconnect` | `monitor:disconnect:start` / `monitor:disconnect:done` |
  | `beforeAppStart` / `afterAppStart`     | `monitor:app:start` / `monitor:app:started`            |
  | `beforeAppStop` / `afterAppStop`       | `monitor:app:stop` / `monitor:app:stopped`             |
  | `onAppError`                           | `monitor:app:error`                                    |
  | `onAppLog` / `onAppErrorLog`           | `monitor:app:log` / `monitor:app:errorLog`             |
  | `beforeShutdown`                       | `monitor:beforeShutdown`                               |

  Additional events with no hook equivalent: `monitor:app:online`, `monitor:app:exit`, `monitor:app:crash`, `monitor:app:restart` / `monitor:app:restarted`, and Windows-specific `monitor:window:foreground` / `monitor:window:minimize` / `monitor:window:hide` / `monitor:window:error`.

  ```ts
  // Before
  { plugins: [{ beforeAppStart: ({ appName }) => { ... }, onAppLog: ({ appName, data }) => { ... } }] }

  // After
  eventBus.on('monitor:app:start', ({ appName }) => { ... })
  eventBus.on('monitor:app:log', ({ appName, data }) => { ... })
  ```

  ### Plugin author renames

  `defineSubsystem` → `definePlugin`, `SubsystemConfig` → `PluginConfig`, `SubsystemContext` → `PluginContext`, `InstantiatedSubsystem` → `InstantiatedPlugin`. A new optional `startupCommands` field is added to `PluginConfig`.

  `PluginDriver` and `HookContextProvider` are removed from `@bluecadet/launchpad-utils`. The new `definePlugin` model replaces the hook-based driver pattern entirely.

  ### Updated import paths

  Most re-exports have been removed from index files in favor of explicit sub-path exports. Nearly all import paths across the ecosystem have changed — see each package's `package.json#exports` for the updated paths.

  `@bluecadet/launchpad` (the meta package) now exposes sub-path exports that mirror the individual packages (e.g. `@bluecadet/launchpad/content/transforms/media-downloader`), replacing the previous flat re-export structure.

  ### New `@bluecadet/launchpad-controller` package

  Provides a centralized controller used internally by the CLI for command execution. End-user APIs are unchanged.

  ### Logging

  File logging config and logic move to the controller package; terminal logging moves to the CLI. Logs are now routed through the event bus, making them visible across processes.

  ### Subsystems are now functions

  Plugins are functional instead of class-based, allowing for simpler logic and easier testing. No changes to the CLI — only to the JS API.

  ### Declaration merging

  Declaration merging moves from the controller package to the utils package, improving type safety when the controller is not a direct dependency.

- [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2) - Introduces `StatusSnapshot` and `ctx.updateState()` for plugin status and state management.

  ### Status: `summarize()`

  Plugins expose an optional `summarize?(state) => Section | null` property on the value returned by `definePlugin()`. It is a pure function over `LaunchpadState` — no chalk, no side effects.

  ```ts
  definePlugin({
    setup(ctx) {
      /* ... */
    },
    summarize(state): Section | null {
      const s = state.plugins.myPlugin;
      if (!s) return null;
      return {
        name: "myPlugin",
        order: 20,
        title: "My Plugin",
        rows: [{ type: "kv", label: "Phase", value: s.phase }],
      };
    },
  });
  ```

  The controller composes a `StatusSnapshot` from each plugin's `summarize` and exposes it over IPC via `client.queryStatusSnapshot()` and `client.onStatusSnapshotChange()`. The CLI's `formatSnapshot()` owns all chalk formatting.

  `Tone`, `Row`, `Section`, and `StatusSnapshot` are exported from `@bluecadet/launchpad-utils/types`.

  ### State: `ctx.updateState()`

  Plugins call `ctx.updateState(patch)` to establish and update their state slice. The controller lazily creates a scoped state store per plugin on first call, handling patch generation, versioning, and broadcasting across processes via Immer.

  ### CLI: `--watch` flag on `status`

  `launchpad status --watch` streams live state updates from a running controller.

### Patch Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d) - Bump dependencies with vulnerabilities

- Updated dependencies [[`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a), [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`73e0d1e`](https://github.com/bluecadet/launchpad/commit/73e0d1e52d623c82fb86488bce35b31e54f8fec8), [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`1460cfd`](https://github.com/bluecadet/launchpad/commit/1460cfd8b762c851935ffe58679c68cfd29dd59f), [`41f432d`](https://github.com/bluecadet/launchpad/commit/41f432d7c51bd1dce64868e002af2d1bd7bb4733), [`b0925c8`](https://github.com/bluecadet/launchpad/commit/b0925c8552e39d23ab9eef76d91ea8cbc2782f92), [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d), [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a), [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c), [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2), [`9061c4d`](https://github.com/bluecadet/launchpad/commit/9061c4d5b967b6973e364428998b4478f9f663bd), [`f18098c`](https://github.com/bluecadet/launchpad/commit/f18098c1454303dc42daeb6e4fbb1a277d32eade), [`22c2428`](https://github.com/bluecadet/launchpad/commit/22c2428abe7a9f21ee66fcdcc108dba0dda5ce09), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a), [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789)]:
  - @bluecadet/launchpad-content@3.0.0
  - @bluecadet/launchpad-cli@3.0.0
  - @bluecadet/launchpad-monitor@3.0.0
  - @bluecadet/launchpad-controller@1.0.0

## 2.0.14

### Patch Changes

- Updated dependencies [[`308f7b9f970716f64e43ecb588ea8619785b8169`](https://github.com/bluecadet/launchpad/commit/308f7b9f970716f64e43ecb588ea8619785b8169), [`391b5abb9c4af86226b10358e8ad5631c55476e8`](https://github.com/bluecadet/launchpad/commit/391b5abb9c4af86226b10358e8ad5631c55476e8), [`3d4b02d77055dea4bbc775a4c94cac8ea8783649`](https://github.com/bluecadet/launchpad/commit/3d4b02d77055dea4bbc775a4c94cac8ea8783649)]:
  - @bluecadet/launchpad-content@2.3.0
  - @bluecadet/launchpad-scaffold@2.0.2
  - @bluecadet/launchpad-cli@2.2.1

## 2.0.13

### Patch Changes

- Updated dependencies [[`d494f7a15a380502f47490045b6c96ae3da0ae14`](https://github.com/bluecadet/launchpad/commit/d494f7a15a380502f47490045b6c96ae3da0ae14), [`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de), [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc), [`df1308167461c0b0b08af6b79a723035930e9f9a`](https://github.com/bluecadet/launchpad/commit/df1308167461c0b0b08af6b79a723035930e9f9a)]:
  - @bluecadet/launchpad-content@2.2.0
  - @bluecadet/launchpad-monitor@2.1.0
  - @bluecadet/launchpad-cli@2.2.0
  - @bluecadet/launchpad-scaffold@2.0.1

## 2.0.12

### Patch Changes

- [#228](https://github.com/bluecadet/launchpad/pull/228) [`68ee26ea4fe86f70a69725af507c8254da764db1`](https://github.com/bluecadet/launchpad/commit/68ee26ea4fe86f70a69725af507c8254da764db1) Thanks [@claytercek](https://github.com/claytercek)! - Forward exports in launchpad package

- Updated dependencies [[`9388a031ce03050445a4023b912559dcdcc41f9d`](https://github.com/bluecadet/launchpad/commit/9388a031ce03050445a4023b912559dcdcc41f9d)]:
  - @bluecadet/launchpad-content@2.1.3

## 2.0.11

### Patch Changes

- Updated dependencies [[`7fee5651f3f98848cad96490b7dfd8ca3966aa92`](https://github.com/bluecadet/launchpad/commit/7fee5651f3f98848cad96490b7dfd8ca3966aa92), [`5441f0dae0913bfbd53cedb5cf4c3ea5b879e33b`](https://github.com/bluecadet/launchpad/commit/5441f0dae0913bfbd53cedb5cf4c3ea5b879e33b), [`2646bacc9dc4db4cc19b345a03d5384c70058811`](https://github.com/bluecadet/launchpad/commit/2646bacc9dc4db4cc19b345a03d5384c70058811)]:
  - @bluecadet/launchpad-monitor@2.0.5
  - @bluecadet/launchpad-content@2.1.2

## 2.0.10

### Patch Changes

- Updated dependencies [[`25f4d25155c3214682c1bfc9514f2de97352c32e`](https://github.com/bluecadet/launchpad/commit/25f4d25155c3214682c1bfc9514f2de97352c32e)]:
  - @bluecadet/launchpad-monitor@2.0.4

## 2.0.9

### Patch Changes

- Updated dependencies [[`bd77ed9b28b080a326580fb018d6d7d76515e273`](https://github.com/bluecadet/launchpad/commit/bd77ed9b28b080a326580fb018d6d7d76515e273), [`8177946a5eb8c5333ef45fd0e4047a75a51de50e`](https://github.com/bluecadet/launchpad/commit/8177946a5eb8c5333ef45fd0e4047a75a51de50e), [`f628fa9556e17b1c8d79334eff2001ae3035a13f`](https://github.com/bluecadet/launchpad/commit/f628fa9556e17b1c8d79334eff2001ae3035a13f), [`078f4ff7a484d584e37ecef10ee5a9eaebe13ded`](https://github.com/bluecadet/launchpad/commit/078f4ff7a484d584e37ecef10ee5a9eaebe13ded)]:
  - @bluecadet/launchpad-content@2.1.1
  - @bluecadet/launchpad-cli@2.1.1

## 2.0.8

### Patch Changes

- Updated dependencies [[`39f1033792dd96468311c45ddedc722dd46f8fc6`](https://github.com/bluecadet/launchpad/commit/39f1033792dd96468311c45ddedc722dd46f8fc6), [`6d87825407cd3df23ae7e146d279e2bc37954421`](https://github.com/bluecadet/launchpad/commit/6d87825407cd3df23ae7e146d279e2bc37954421)]:
  - @bluecadet/launchpad-monitor@2.0.3

## 2.0.7

### Patch Changes

- Updated dependencies [[`afbe6093f444c5cf2669fa58b4c557638f6aefe7`](https://github.com/bluecadet/launchpad/commit/afbe6093f444c5cf2669fa58b4c557638f6aefe7)]:
  - @bluecadet/launchpad-monitor@2.0.2

## 2.0.6

### Patch Changes

- Updated dependencies [[`806fb9a1dcedc0e359bedba7d38a47b73d712b68`](https://github.com/bluecadet/launchpad/commit/806fb9a1dcedc0e359bedba7d38a47b73d712b68), [`1cda9a73ecf4a6d937abbe58bf95469765c67ec2`](https://github.com/bluecadet/launchpad/commit/1cda9a73ecf4a6d937abbe58bf95469765c67ec2)]:
  - @bluecadet/launchpad-content@2.1.0
  - @bluecadet/launchpad-cli@2.1.0

## 2.0.5

### Patch Changes

- Updated dependencies [[`1138c2b7040bd05c45a4d4e3b242f73d69da1de4`](https://github.com/bluecadet/launchpad/commit/1138c2b7040bd05c45a4d4e3b242f73d69da1de4)]:
  - @bluecadet/launchpad-cli@2.0.2

## 2.0.4

### Patch Changes

- Updated dependencies [[`710c05e16edd27ea40c32268351555fb10ed1639`](https://github.com/bluecadet/launchpad/commit/710c05e16edd27ea40c32268351555fb10ed1639)]:
  - @bluecadet/launchpad-monitor@2.0.1

## 2.0.3

### Patch Changes

- Updated dependencies [[`babd99e1c76ec83c8003815f1c23653a7a122177`](https://github.com/bluecadet/launchpad/commit/babd99e1c76ec83c8003815f1c23653a7a122177)]:
  - @bluecadet/launchpad-content@2.0.3
  - @bluecadet/launchpad-cli@2.0.1

## 2.0.2

### Patch Changes

- Updated dependencies [[`ca483809c70ecaa5d7cd407143303e0c5899b0d4`](https://github.com/bluecadet/launchpad/commit/ca483809c70ecaa5d7cd407143303e0c5899b0d4)]:
  - @bluecadet/launchpad-content@2.0.2

## 2.0.1

### Patch Changes

- Updated dependencies [[`d37489707a9814755828a0fca011c61823884617`](https://github.com/bluecadet/launchpad/commit/d37489707a9814755828a0fca011c61823884617)]:
  - @bluecadet/launchpad-content@2.0.1

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

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`9252b2489f1e7170223c2c2bfaffe2202d32b59a`](https://github.com/bluecadet/launchpad/commit/9252b2489f1e7170223c2c2bfaffe2202d32b59a), [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935), [`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1), [`6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02`](https://github.com/bluecadet/launchpad/commit/6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02), [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989), [`75622fbcf94d84717d6c1107799b5d745828a7a6`](https://github.com/bluecadet/launchpad/commit/75622fbcf94d84717d6c1107799b5d745828a7a6), [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0), [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef), [`aa37868b6135cafb2b89fae11b11d261f27ff6df`](https://github.com/bluecadet/launchpad/commit/aa37868b6135cafb2b89fae11b11d261f27ff6df), [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741), [`5d5ead5bd77c97d69ed908cb00516d600708210a`](https://github.com/bluecadet/launchpad/commit/5d5ead5bd77c97d69ed908cb00516d600708210a), [`afbf13e74bebfdc788876292685bce374f8c42e2`](https://github.com/bluecadet/launchpad/commit/afbf13e74bebfdc788876292685bce374f8c42e2), [`795eb39bcf9131615dd1e34c9c02933f8352f082`](https://github.com/bluecadet/launchpad/commit/795eb39bcf9131615dd1e34c9c02933f8352f082), [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1)]:
  - @bluecadet/launchpad-monitor@2.0.0
  - @bluecadet/launchpad-scaffold@2.0.0
  - @bluecadet/launchpad-content@2.0.0
  - @bluecadet/launchpad-cli@2.0.0
  - @bluecadet/launchpad-dashboard@2.0.0

## 2.0.0-next.5

### Patch Changes

- Updated dependencies [[`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1)]:
  - @bluecadet/launchpad-content@2.0.0-next.8
  - @bluecadet/launchpad-cli@2.0.0-next.5

## 2.0.0-next.4

### Patch Changes

- Updated dependencies [[`6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02`](https://github.com/bluecadet/launchpad/commit/6d9ae5f944e74f3bd7ca6b0c18cac7c09da01d02), [`aa37868b6135cafb2b89fae11b11d261f27ff6df`](https://github.com/bluecadet/launchpad/commit/aa37868b6135cafb2b89fae11b11d261f27ff6df)]:
  - @bluecadet/launchpad-content@2.0.0-next.7

## 2.0.0-next.3

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- Updated dependencies [[`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935)]:
  - @bluecadet/launchpad-scaffold@2.0.0-next.3
  - @bluecadet/launchpad-content@2.0.0-next.6
  - @bluecadet/launchpad-monitor@2.0.0-next.4
  - @bluecadet/launchpad-cli@2.0.0-next.4

## 2.0.0-next.2

### Minor Changes

- [#176](https://github.com/bluecadet/launchpad/pull/176) [`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e) Thanks [@claytercek](https://github.com/claytercek)! - update logging

### Patch Changes

- Updated dependencies [[`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e), [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3)]:
  - @bluecadet/launchpad-content@2.0.0-next.4
  - @bluecadet/launchpad-monitor@2.0.0-next.3
  - @bluecadet/launchpad-cli@2.0.0-next.2

## 2.0.0-next.1

### Patch Changes

- [#170](https://github.com/bluecadet/launchpad/pull/170) [`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3), [`f60543df8c24dbb2043940ce1fec52ac09036735`](https://github.com/bluecadet/launchpad/commit/f60543df8c24dbb2043940ce1fec52ac09036735)]:
  - @bluecadet/launchpad-dashboard@2.0.0-next.1
  - @bluecadet/launchpad-scaffold@2.0.0-next.1
  - @bluecadet/launchpad-content@2.0.0-next.2
  - @bluecadet/launchpad-monitor@2.0.0-next.2
  - @bluecadet/launchpad-utils@2.0.0-next.2
  - @bluecadet/launchpad-cli@2.0.0-next.1

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
  - @bluecadet/launchpad-dashboard@2.0.0-next.0
  - @bluecadet/launchpad-scaffold@2.0.0-next.0
  - @bluecadet/launchpad-content@2.0.0-next.0
  - @bluecadet/launchpad-monitor@2.0.0-next.0
  - @bluecadet/launchpad-utils@2.0.0-next.0
  - @bluecadet/launchpad-cli@2.0.0-next.0

## 1.5.2

### Patch Changes

- Updated dependencies [[`4bafb91969f7768b00f8ed353eb7b86b611dff9e`](https://github.com/bluecadet/launchpad/commit/4bafb91969f7768b00f8ed353eb7b86b611dff9e)]:
  - @bluecadet/launchpad-content@1.14.0

## 1.5.1

### Patch Changes

- Updated dependencies [[`b7fa754826aa9201da0f02ed864ecde2cbb1ed1b`](https://github.com/bluecadet/launchpad/commit/b7fa754826aa9201da0f02ed864ecde2cbb1ed1b)]:
  - @bluecadet/launchpad-content@1.13.0

## 1.5.0

### Minor Changes

- [#128](https://github.com/bluecadet/launchpad/pull/128) [`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72) Thanks [@claytercek](https://github.com/claytercek)! - Add intellisense support to configs

- [#124](https://github.com/bluecadet/launchpad/pull/124) [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd) Thanks [@claytercek](https://github.com/claytercek)! - support js configs

- [#133](https://github.com/bluecadet/launchpad/pull/133) [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1) Thanks [@claytercek](https://github.com/claytercek)! - Load dotenv files when launching from CLI

### Patch Changes

- [#132](https://github.com/bluecadet/launchpad/pull/132) [`2393473`](https://github.com/bluecadet/launchpad/commit/2393473c61e7daa74e6363ffb758107817da1035) Thanks [@claytercek](https://github.com/claytercek)! - Add intellisense for hook names

- [#118](https://github.com/bluecadet/launchpad/pull/118) [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa) Thanks [@claytercek](https://github.com/claytercek)! - Generate d.ts declaration files for intellisense, and fix all type errors.

- Updated dependencies [[`e11973d`](https://github.com/bluecadet/launchpad/commit/e11973d902f90ef3b94d7e29af23ea766301fc72), [`55a98ba`](https://github.com/bluecadet/launchpad/commit/55a98ba9a2a50451fb733a0122f0054c59dc26dd), [`4d537f2`](https://github.com/bluecadet/launchpad/commit/4d537f297d9c85b22a35f406e06e15d429ca7eb1), [`9e6d6d4`](https://github.com/bluecadet/launchpad/commit/9e6d6d417310697d29e6fb6656e87ff3d2bc3205), [`0aed873`](https://github.com/bluecadet/launchpad/commit/0aed87333dcc3902adb077365a330a8e9190cefa)]:
  - @bluecadet/launchpad-content@1.12.0
  - @bluecadet/launchpad-monitor@1.8.0
  - @bluecadet/launchpad-utils@1.5.0
  - @bluecadet/launchpad-dashboard@1.5.0
  - @bluecadet/launchpad-scaffold@1.8.0

## 1.4.4

### Patch Changes

- Updated dependencies [[`6502ded`](https://github.com/bluecadet/launchpad/commit/6502ded3105bd803d38978758d4c3794fc54cd8c)]:
  - @bluecadet/launchpad-content@1.11.0

## 1.4.3

### Patch Changes

- [`851111b`](https://github.com/bluecadet/launchpad/commit/851111b5901fe146f78a9136034753d0d2641d62) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Minor readme update

## 1.4.2

### Patch Changes

- [`740b19b`](https://github.com/bluecadet/launchpad/commit/740b19bca04986ce2a5ab00e834c4a252da9d912) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Minor readme update

## 1.4.1

### Patch Changes

- [`0a62a90`](https://github.com/bluecadet/launchpad/commit/0a62a9083b80eec5587c3ea5c465672c2e041282) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

- Updated dependencies [[`0a62a90`](https://github.com/bluecadet/launchpad/commit/0a62a9083b80eec5587c3ea5c465672c2e041282), [`9efdf12`](https://github.com/bluecadet/launchpad/commit/9efdf12230d31fef8fe9c5708dbe7eb145c398e2)]:
  - @bluecadet/launchpad-content@1.10.1
  - @bluecadet/launchpad-scaffold@1.7.1

## 1.4.0

### Minor Changes

- [#98](https://github.com/bluecadet/launchpad/pull/98) [`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added eslint and reformated code

### Patch Changes

- Updated dependencies [[`a56c4f4`](https://github.com/bluecadet/launchpad/commit/a56c4f42e1ade3513783b7ccab3d8ff979f5deee)]:
  - @bluecadet/launchpad-content@1.10.0
  - @bluecadet/launchpad-dashboard@1.4.0
  - @bluecadet/launchpad-monitor@1.7.0
  - @bluecadet/launchpad-scaffold@1.7.0
  - @bluecadet/launchpad-utils@1.4.0

## 1.3.9

### Patch Changes

- Updated dependencies [[`852ed2f`](https://github.com/bluecadet/launchpad/commit/852ed2f0e10f00210f91ec37e7d087f7cebe7911)]:
  - @bluecadet/launchpad-scaffold@1.6.0

## 1.3.8

### Patch Changes

- Updated dependencies [[`56a0a60`](https://github.com/bluecadet/launchpad/commit/56a0a60d88671d788a90eb80c5d0b37187879158)]:
  - @bluecadet/launchpad-monitor@1.6.0
  - @bluecadet/launchpad-utils@1.3.2

## 1.3.7

### Patch Changes

- Updated dependencies [[`31282d1`](https://github.com/bluecadet/launchpad/commit/31282d1bbf122e1eb989bdba3c2baa77053e7edc)]:
  - @bluecadet/launchpad-monitor@1.5.0

## 1.3.6

### Patch Changes

- [#86](https://github.com/bluecadet/launchpad/pull/86) [`8a23491`](https://github.com/bluecadet/launchpad/commit/8a23491c2ef31cca7c89f9820fac3ba849e5aeb2) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Fixed changeset release dependencies

## 1.3.5

### Patch Changes

- Updated dependencies [[`f1ceb41`](https://github.com/bluecadet/launchpad/commit/f1ceb41c61d7eb8cce48d3ae2c81e39dd341e84c)]:
  - @bluecadet/launchpad-monitor@1.4.0

## 1.3.4

### Patch Changes

- Updated dependencies [[`c911be2`](https://github.com/bluecadet/launchpad/commit/c911be2b406d8ff9d6fbc7d17d16af24af26f58a)]:
  - @bluecadet/launchpad-content@1.9.0

## 1.3.3

### Patch Changes

- [`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

- Updated dependencies [[`b701b3d`](https://github.com/bluecadet/launchpad/commit/b701b3db5b7177393a5dd0b53c8dcac82f0994e3)]:
  - @bluecadet/launchpad-content@1.8.1
  - @bluecadet/launchpad-monitor@1.3.1
  - @bluecadet/launchpad-utils@1.3.1

## 1.3.2

### Patch Changes

- [#75](https://github.com/bluecadet/launchpad/pull/75) [`10047df`](https://github.com/bluecadet/launchpad/commit/10047df99cd96d736c7b55213535744e0dbe90bf) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Added CI workflow

## 1.3.1

### Patch Changes

- Updated dependencies [[`acd0ef8`](https://github.com/bluecadet/launchpad/commit/acd0ef86ef3af15c04c769b02db2ff5cff00bcff)]:
  - @bluecadet/launchpad-scaffold@1.5.0

## 1.3.0

### Minor Changes

- [#68](https://github.com/bluecadet/launchpad/pull/68) [`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Updated documentation

### Patch Changes

- Updated dependencies [[`a7172da`](https://github.com/bluecadet/launchpad/commit/a7172dad86b0f8ab479128b013593e13f36cb0e3)]:
  - @bluecadet/launchpad-content@1.8.0
  - @bluecadet/launchpad-dashboard@1.3.0
  - @bluecadet/launchpad-monitor@1.3.0
  - @bluecadet/launchpad-scaffold@1.4.0
  - @bluecadet/launchpad-utils@1.3.0

## 1.2.6

### Patch Changes

- Updated dependencies [[`42eff47`](https://github.com/bluecadet/launchpad/commit/42eff47933462c808f931d9e6578b6d47015b410)]:
  - @bluecadet/launchpad-scaffold@1.3.0

## 1.2.5

### Patch Changes

- Updated dependencies [[`f3c7916`](https://github.com/bluecadet/launchpad/commit/f3c79169001dd157c7e3bce24da41409a3906d53)]:
  - @bluecadet/launchpad-content@1.7.0

## 1.2.4

### Patch Changes

- Updated dependencies [[`a4132da`](https://github.com/bluecadet/launchpad/commit/a4132da0187f669ad95251e2f3903229e87d6123)]:
  - @bluecadet/launchpad-content@1.6.0

## 1.2.3

### Patch Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-content@1.5.0
  - @bluecadet/launchpad-monitor@1.2.1
  - @bluecadet/launchpad-utils@1.2.1
  - @bluecadet/launchpad-dashboard@1.2.1
  - @bluecadet/launchpad-scaffold@1.2.1

## 1.2.3-next.0

### Patch Changes

- [#61](https://github.com/bluecadet/launchpad/pull/61) [`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Refactored media downloads to support alt local paths. Adds support for Sanity image hotspots.

- Updated dependencies [[`f9b2140`](https://github.com/bluecadet/launchpad/commit/f9b21407af6d4f874473eed860e7a925475b7e41)]:
  - @bluecadet/launchpad-content@1.5.0-next.0
  - @bluecadet/launchpad-monitor@1.2.1-next.0
  - @bluecadet/launchpad-utils@1.2.1-next.0
  - @bluecadet/launchpad-dashboard@1.2.1-next.0
  - @bluecadet/launchpad-scaffold@1.2.1-next.0

## 1.2.2

### Patch Changes

- Updated dependencies [[`7f93181`](https://github.com/bluecadet/launchpad/commit/7f9318171c7d44ef812243454608d75810895d14), [`c9a66e1`](https://github.com/bluecadet/launchpad/commit/c9a66e1416d49c1447d010ab08b3de9c45b4e0a0)]:
  - @bluecadet/launchpad-content@1.4.0

## 1.2.1

### Patch Changes

- [#50](https://github.com/bluecadet/launchpad/pull/50) [`5f42f28`](https://github.com/bluecadet/launchpad/commit/5f42f282ffb670701b3803d6c2c724e0f6475178) Thanks [@claytercek](https://github.com/claytercek)! - update readme

## 1.2.0

### Minor Changes

- [#39](https://github.com/bluecadet/launchpad/pull/39) [`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23) Thanks [@github-actions](https://github.com/apps/github-actions)! - Changeset monorepo restructure

### Patch Changes

- Updated dependencies [[`7611cc4`](https://github.com/bluecadet/launchpad/commit/7611cc40742bf32012d5ce6dd5da155644ba0e23)]:
  - @bluecadet/launchpad-content@1.3.0
  - @bluecadet/launchpad-dashboard@1.2.0
  - @bluecadet/launchpad-monitor@1.2.0
  - @bluecadet/launchpad-scaffold@1.2.0
  - @bluecadet/launchpad-utils@1.2.0

## 1.1.0

### Minor Changes

- [#28](https://github.com/bluecadet/launchpad/pull/28) [`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc) Thanks [@benjaminbojko](https://github.com/benjaminbojko)! - Start using [🦋 Changesets](https://github.com/changesets/changesets) to manage releases.

### Patch Changes

- Updated dependencies [[`fcaff92`](https://github.com/bluecadet/launchpad/commit/fcaff9254f86b4313f9a1a737b19c26cc0839dfc)]:
  - @bluecadet/launchpad-content@1.2.0
  - @bluecadet/launchpad-dashboard@1.1.0
  - @bluecadet/launchpad-monitor@1.1.0
  - @bluecadet/launchpad-scaffold@1.1.0
  - @bluecadet/launchpad-utils@1.1.0
