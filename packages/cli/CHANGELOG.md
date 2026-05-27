# @bluecadet/launchpad-cli

## 3.0.1

### Patch Changes

- [#294](https://github.com/bluecadet/launchpad/pull/294) [`c1f791a`](https://github.com/bluecadet/launchpad/commit/c1f791a2c884fdd15ab8eed3e47949b999d879b9) - Remove dotenv ads from the CLI

## 3.0.0

### Major Changes

- [#283](https://github.com/bluecadet/launchpad/pull/283) [`73e0d1e`](https://github.com/bluecadet/launchpad/commit/73e0d1e52d623c82fb86488bce35b31e54f8fec8) - Remove the `scaffold` package and `launchpad scaffold` CLI command. Windows kiosk and exhibit machine configuration is now handled by [Preflight](https://github.com/bluecadet/preflight), a dedicated tool by Bluecadet.

  **Migration**: If you relied on `launchpad scaffold` or `@bluecadet/launchpad/scaffold`, switch to [Preflight](https://github.com/bluecadet/preflight).

- [#293](https://github.com/bluecadet/launchpad/pull/293) [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c) - Plugins can now declare CLI commands via `manifest.cli`. The hardcoded `content` and `monitor` CLI commands are removed — both plugins now declare their commands via their manifests. See the `@bluecadet/launchpad` changelog for migration details.

- [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2) - Replaces the hook-based plugin system with a unified plugin model across all packages. See the `@bluecadet/launchpad` changelog for migration details.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`f18098c`](https://github.com/bluecadet/launchpad/commit/f18098c1454303dc42daeb6e4fbb1a277d32eade) - Add log level flag to CLI to control verbosity of terminal output.

  ```bash
  npx launchpad <command> -v # or --verbose, includes verbose logs
  npx launchpad <command> -vv # for more verbosity, includes debug logs
  ```

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Introduces `StatusSnapshot` and `ctx.updateState()` for plugin status and state management. See the `@bluecadet/launchpad` changelog for migration details.

### Minor Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Breaking changes to the content fetch pipeline, path helpers, and file path defaults. See the `@bluecadet/launchpad` changelog for migration details.

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

### Patch Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d) - Bump dependencies with vulnerabilities

- Updated dependencies [[`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`b0925c8`](https://github.com/bluecadet/launchpad/commit/b0925c8552e39d23ab9eef76d91ea8cbc2782f92), [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d), [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a), [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c), [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a)]:
  - @bluecadet/launchpad-utils@3.0.0
  - @bluecadet/launchpad-controller@1.0.0

## 2.2.1

### Patch Changes

- Updated dependencies [[`308f7b9f970716f64e43ecb588ea8619785b8169`](https://github.com/bluecadet/launchpad/commit/308f7b9f970716f64e43ecb588ea8619785b8169), [`391b5abb9c4af86226b10358e8ad5631c55476e8`](https://github.com/bluecadet/launchpad/commit/391b5abb9c4af86226b10358e8ad5631c55476e8)]:
  - @bluecadet/launchpad-content@2.3.0

## 2.2.0

### Minor Changes

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de) Thanks [@claytercek](https://github.com/claytercek)! - Support absolute or relative paths in launchpad config.

- [#233](https://github.com/bluecadet/launchpad/pull/233) [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc) Thanks [@claytercek](https://github.com/claytercek)! - Resolve all paths relative to the launchpad config directory when run from the CLI

### Patch Changes

- Updated dependencies [[`d494f7a15a380502f47490045b6c96ae3da0ae14`](https://github.com/bluecadet/launchpad/commit/d494f7a15a380502f47490045b6c96ae3da0ae14), [`1ab527da451473120a923023a758eea0371f80de`](https://github.com/bluecadet/launchpad/commit/1ab527da451473120a923023a758eea0371f80de), [`2a26a087fe7e364e04e213e8da2f9af04aa067fc`](https://github.com/bluecadet/launchpad/commit/2a26a087fe7e364e04e213e8da2f9af04aa067fc), [`df1308167461c0b0b08af6b79a723035930e9f9a`](https://github.com/bluecadet/launchpad/commit/df1308167461c0b0b08af6b79a723035930e9f9a)]:
  - @bluecadet/launchpad-content@2.2.0
  - @bluecadet/launchpad-monitor@2.1.0
  - @bluecadet/launchpad-utils@2.1.0

## 2.1.1

### Patch Changes

- [#221](https://github.com/bluecadet/launchpad/pull/221) [`8177946a5eb8c5333ef45fd0e4047a75a51de50e`](https://github.com/bluecadet/launchpad/commit/8177946a5eb8c5333ef45fd0e4047a75a51de50e) Thanks [@claytercek](https://github.com/claytercek)! - Smarter/faster config search

- Updated dependencies [[`553bb964a52f6246d59f93ff72631cb963441dd5`](https://github.com/bluecadet/launchpad/commit/553bb964a52f6246d59f93ff72631cb963441dd5)]:
  - @bluecadet/launchpad-utils@2.0.1

## 2.1.0

### Minor Changes

- [#212](https://github.com/bluecadet/launchpad/pull/212) [`1cda9a73ecf4a6d937abbe58bf95469765c67ec2`](https://github.com/bluecadet/launchpad/commit/1cda9a73ecf4a6d937abbe58bf95469765c67ec2) Thanks [@claytercek](https://github.com/claytercek)! - Use unjs' jiti to load config files, enabling support for typescript.

### Patch Changes

- Updated dependencies [[`806fb9a1dcedc0e359bedba7d38a47b73d712b68`](https://github.com/bluecadet/launchpad/commit/806fb9a1dcedc0e359bedba7d38a47b73d712b68)]:
  - @bluecadet/launchpad-content@2.1.0

## 2.0.2

### Patch Changes

- [#210](https://github.com/bluecadet/launchpad/pull/210) [`1138c2b7040bd05c45a4d4e3b242f73d69da1de4`](https://github.com/bluecadet/launchpad/commit/1138c2b7040bd05c45a4d4e3b242f73d69da1de4) Thanks [@claytercek](https://github.com/claytercek)! - fix dotenv cascade order

## 2.0.1

### Patch Changes

- [#206](https://github.com/bluecadet/launchpad/pull/206) [`babd99e1c76ec83c8003815f1c23653a7a122177`](https://github.com/bluecadet/launchpad/commit/babd99e1c76ec83c8003815f1c23653a7a122177) Thanks [@claytercek](https://github.com/claytercek)! - fix optional dependencies. Make them optional _peer_ dependencies instead.

- Updated dependencies [[`babd99e1c76ec83c8003815f1c23653a7a122177`](https://github.com/bluecadet/launchpad/commit/babd99e1c76ec83c8003815f1c23653a7a122177)]:
  - @bluecadet/launchpad-content@2.0.3

## 2.0.0

### Major Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Minor Changes

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- [#191](https://github.com/bluecadet/launchpad/pull/191) [`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1) Thanks [@claytercek](https://github.com/claytercek)! - More verbose error logging, plus better messages on source configs with unions

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- [#179](https://github.com/bluecadet/launchpad/pull/179) [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`9252b2489f1e7170223c2c2bfaffe2202d32b59a`](https://github.com/bluecadet/launchpad/commit/9252b2489f1e7170223c2c2bfaffe2202d32b59a), [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935), [`754ddd330f9e626b45a08bc7d6ce84f057bbb989`](https://github.com/bluecadet/launchpad/commit/754ddd330f9e626b45a08bc7d6ce84f057bbb989), [`75622fbcf94d84717d6c1107799b5d745828a7a6`](https://github.com/bluecadet/launchpad/commit/75622fbcf94d84717d6c1107799b5d745828a7a6), [`af3ef8664bea647a93a36cd9703c143db060d8d0`](https://github.com/bluecadet/launchpad/commit/af3ef8664bea647a93a36cd9703c143db060d8d0), [`543c836deac30d8f3b18a377db0f8c4f051ea8ef`](https://github.com/bluecadet/launchpad/commit/543c836deac30d8f3b18a377db0f8c4f051ea8ef), [`a35e2b2ad94b0cbd183bb48d278cf1951b945741`](https://github.com/bluecadet/launchpad/commit/a35e2b2ad94b0cbd183bb48d278cf1951b945741), [`2c2866a77482a18759a4fdacafcb7e6493db6dbb`](https://github.com/bluecadet/launchpad/commit/2c2866a77482a18759a4fdacafcb7e6493db6dbb), [`3dd25b3ff7d4636fab43812af2714db948f600e1`](https://github.com/bluecadet/launchpad/commit/3dd25b3ff7d4636fab43812af2714db948f600e1)]:
  - @bluecadet/launchpad-utils@2.0.0

## 2.0.0-next.5

### Patch Changes

- [#191](https://github.com/bluecadet/launchpad/pull/191) [`879d4de542038d5e9910de149307fb8434a04cd1`](https://github.com/bluecadet/launchpad/commit/879d4de542038d5e9910de149307fb8434a04cd1) Thanks [@claytercek](https://github.com/claytercek)! - More verbose error logging, plus better messages on source configs with unions

## 2.0.0-next.4

### Patch Changes

- [#185](https://github.com/bluecadet/launchpad/pull/185) [`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935) Thanks [@claytercek](https://github.com/claytercek)! - Include package.json in exports

- Updated dependencies [[`0c3887a48977daa001abbfe0fc8d94aa3bfd6935`](https://github.com/bluecadet/launchpad/commit/0c3887a48977daa001abbfe0fc8d94aa3bfd6935)]:
  - @bluecadet/launchpad-utils@2.0.0-next.5

## 2.0.0-next.3

### Patch Changes

- [#178](https://github.com/bluecadet/launchpad/pull/178) [`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758) Thanks [@claytercek](https://github.com/claytercek)! - Add image transform plugins

- Updated dependencies [[`f8c6ceff03b9e46871bcfb2569c7c7e510ec8758`](https://github.com/bluecadet/launchpad/commit/f8c6ceff03b9e46871bcfb2569c7c7e510ec8758), [`a6f330947de66ba5b95abdf06f66ecfaca67bd0a`](https://github.com/bluecadet/launchpad/commit/a6f330947de66ba5b95abdf06f66ecfaca67bd0a)]:
  - @bluecadet/launchpad-utils@2.0.0-next.4

## 2.0.0-next.2

### Minor Changes

- [#174](https://github.com/bluecadet/launchpad/pull/174) [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3) Thanks [@claytercek](https://github.com/claytercek)! - convert configs to zod validators

### Patch Changes

- Updated dependencies [[`1f650aad8db1c55709ae976ceb705ffac175b76e`](https://github.com/bluecadet/launchpad/commit/1f650aad8db1c55709ae976ceb705ffac175b76e), [`6436e938efe9fafba0aa52ea7bdefe33d5fe77e3`](https://github.com/bluecadet/launchpad/commit/6436e938efe9fafba0aa52ea7bdefe33d5fe77e3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.3

## 2.0.0-next.1

### Patch Changes

- [#170](https://github.com/bluecadet/launchpad/pull/170) [`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3) Thanks [@claytercek](https://github.com/claytercek)! - refactor to TS

- Updated dependencies [[`1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3`](https://github.com/bluecadet/launchpad/commit/1cc1ce86b43cd34d4e531c8e88fa173edc1fcee3)]:
  - @bluecadet/launchpad-utils@2.0.0-next.2

## 2.0.0-next.0

### Major Changes

- [#165](https://github.com/bluecadet/launchpad/pull/165) [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de) Thanks [@claytercek](https://github.com/claytercek)! - **New CLI Package**:
  - Move CLI to separate package
  - Lazy import CLI commands to improve startup time
  - Move config and dotenv loading and parsing to CLI package
  - convert core package to have no code, just a shorthand for installing all sub-packages

### Patch Changes

- Updated dependencies [[`3d40d3c3f47afe080f642b3188f5e62a529a891b`](https://github.com/bluecadet/launchpad/commit/3d40d3c3f47afe080f642b3188f5e62a529a891b), [`205157ef8a2dddf2eda14c41730604f5e80d87de`](https://github.com/bluecadet/launchpad/commit/205157ef8a2dddf2eda14c41730604f5e80d87de)]:
  - @bluecadet/launchpad-utils@2.0.0-next.0
