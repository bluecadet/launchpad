# @bluecadet/launchpad-cli

## 3.0.0

### Major Changes

- [#262](https://github.com/bluecadet/launchpad/pull/262) [`29c2ccb`](https://github.com/bluecadet/launchpad/commit/29c2ccb6492270dad61bebc17c1f6a3f010bda45) Thanks [@claytercek](https://github.com/claytercek)! - Refactor package exports. Removed most re-exports from the index files, and added additional package export paths. Also refactored the launchpad meta package to generate export paths that match the individual packages. This updates nearly all import paths across the entire launchpad ecosystem.

- [#268](https://github.com/bluecadet/launchpad/pull/268) [`87d5384`](https://github.com/bluecadet/launchpad/commit/87d53849604b916e54da88d78f8d3733231f2421) Thanks [@claytercek](https://github.com/claytercek)! - Add log level flag to CLI to control verbosity of terminal output.

  ```bash
  npx launchpad <command> -v # or --verbose, includes verbose logs
  npx launchpad <command> -vv # for more verbosity, includes debug logs
  ```

### Minor Changes

- [#249](https://github.com/bluecadet/launchpad/pull/249) [`a9a2c10`](https://github.com/bluecadet/launchpad/commit/a9a2c1032f0b652aa07492e0867db3bdf5e6a520) Thanks [@claytercek](https://github.com/claytercek)! - Introduces the new `@bluecadet/launchpad-controller` package, which provides a centralized controller architecture for Launchpad. End user APIs remain unchanged, with the controller used internally by the CLI for command execution in "task mode".

- [#260](https://github.com/bluecadet/launchpad/pull/260) [`747dce1`](https://github.com/bluecadet/launchpad/commit/747dce11b946502619d7f730ae0e757eaf3e799a) Thanks [@claytercek](https://github.com/claytercek)! - refactor: extract content fetch pipeline into stages

  Extract the fetch pipeline from LaunchpadContent into composable stage functions (setupHooks, backup, clearOldData, fetchSources, etc.) for better testability and modularity. Simplify state management with inline phase tracking. Add comprehensive tests for fetch context and stages.

  This is a breaking change as it modifies the API of LaunchpadContent by adding the loadSources() method, as well as changing the fetch() and clear() methods to accept just the source IDs instead of full source objects.

- [#268](https://github.com/bluecadet/launchpad/pull/268) [`fb70176`](https://github.com/bluecadet/launchpad/commit/fb70176e9bfda8194006b1e77d2f69b55a7df7e7) Thanks [@claytercek](https://github.com/claytercek)! - Move file logging config and logic to controller, and terminal logging to CLI. Refactor logging to use event bus, so logs are visible across processes.

  Also adds a SubsystemContext type to be shared across packages.

- [#260](https://github.com/bluecadet/launchpad/pull/260) [`376ee60`](https://github.com/bluecadet/launchpad/commit/376ee6072f13fba86937a327cd14ba274f8ad972) Thanks [@claytercek](https://github.com/claytercek)! - Move declaration merging to utils package instead of controller package.

  This improves type safety when the controller package is not a dependency, such as when using content/monitor packages in isolation.

  The API stays largely the same, with some minor adjustments to import paths and type exports.

- [#257](https://github.com/bluecadet/launchpad/pull/257) [`e254db8`](https://github.com/bluecadet/launchpad/commit/e254db82417a768847b942d2d10f6d101445f945) Thanks [@claytercek](https://github.com/claytercek)! - Adds 'start' command to CLI for starting launchpad controller in 'persistent' mode. This mode opens an IPC socket, allowing subsequent CLI commands to connect to the running controller instance. The command can be launched with the `-d/--detach` flag to run it in the background. Phase 2 of the multi-interface controller architecture.

- [#260](https://github.com/bluecadet/launchpad/pull/260) [`3495b26`](https://github.com/bluecadet/launchpad/commit/3495b266f16a5b9ada5457d5b1d884bac9bfc23f) Thanks [@claytercek](https://github.com/claytercek)! - Refactor monitor and content state to use Immer. This allows us to emit patch events when state changes, which are then handled by the controller package to sync state across processes (just IPC for now).

  Adds a new "watch" flag to the CLI status command to allow live monitoring of the controller status.

### Patch Changes

- [#260](https://github.com/bluecadet/launchpad/pull/260) [`634fa94`](https://github.com/bluecadet/launchpad/commit/634fa9490c50e2bfb638524d76c1bde3891aaee9) Thanks [@claytercek](https://github.com/claytercek)! - Move LaunchpadConfig type definition from cli package to utils package, allowing for declaration merging.

- [#269](https://github.com/bluecadet/launchpad/pull/269) [`9f47258`](https://github.com/bluecadet/launchpad/commit/9f47258763ac210a5982bad66bc17bfe98d239e3) Thanks [@claytercek](https://github.com/claytercek)! - Bump dependencies with vulnerabilities

- [#268](https://github.com/bluecadet/launchpad/pull/268) [`6f636b6`](https://github.com/bluecadet/launchpad/commit/6f636b6256d83b52600cf518e7d510712f3b5470) Thanks [@claytercek](https://github.com/claytercek)! - Refactor subsystems to be functional instead of classes. This allows for simpler logic and easier testing. No changes to the CLI, only the JS API.

- Updated dependencies [[`a9a2c10`](https://github.com/bluecadet/launchpad/commit/a9a2c1032f0b652aa07492e0867db3bdf5e6a520), [`747dce1`](https://github.com/bluecadet/launchpad/commit/747dce11b946502619d7f730ae0e757eaf3e799a), [`2bbb15c`](https://github.com/bluecadet/launchpad/commit/2bbb15cfc58114b84ca5666761c652cda218ceb1), [`82dae70`](https://github.com/bluecadet/launchpad/commit/82dae7011cdedb87d28b8297142495db1fb165f6), [`634fa94`](https://github.com/bluecadet/launchpad/commit/634fa9490c50e2bfb638524d76c1bde3891aaee9), [`fb70176`](https://github.com/bluecadet/launchpad/commit/fb70176e9bfda8194006b1e77d2f69b55a7df7e7), [`34bc601`](https://github.com/bluecadet/launchpad/commit/34bc601fa694d529a55ad2c8f67443d04388ec3f), [`9f47258`](https://github.com/bluecadet/launchpad/commit/9f47258763ac210a5982bad66bc17bfe98d239e3), [`6f636b6`](https://github.com/bluecadet/launchpad/commit/6f636b6256d83b52600cf518e7d510712f3b5470), [`29c2ccb`](https://github.com/bluecadet/launchpad/commit/29c2ccb6492270dad61bebc17c1f6a3f010bda45), [`6f636b6`](https://github.com/bluecadet/launchpad/commit/6f636b6256d83b52600cf518e7d510712f3b5470), [`376ee60`](https://github.com/bluecadet/launchpad/commit/376ee6072f13fba86937a327cd14ba274f8ad972), [`74fc748`](https://github.com/bluecadet/launchpad/commit/74fc748901789bb0cca2986346c62db55a1a94d9), [`e254db8`](https://github.com/bluecadet/launchpad/commit/e254db82417a768847b942d2d10f6d101445f945), [`e254db8`](https://github.com/bluecadet/launchpad/commit/e254db82417a768847b942d2d10f6d101445f945), [`3495b26`](https://github.com/bluecadet/launchpad/commit/3495b266f16a5b9ada5457d5b1d884bac9bfc23f)]:
  - @bluecadet/launchpad-controller@1.0.0
  - @bluecadet/launchpad-content@3.0.0
  - @bluecadet/launchpad-monitor@3.0.0
  - @bluecadet/launchpad-utils@3.0.0
  - @bluecadet/launchpad-scaffold@3.0.0

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
