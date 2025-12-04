# @bluecadet/launchpad-controller

## 1.0.0

### Major Changes

- [#249](https://github.com/bluecadet/launchpad/pull/249) [`a9a2c10`](https://github.com/bluecadet/launchpad/commit/a9a2c1032f0b652aa07492e0867db3bdf5e6a520) Thanks [@claytercek](https://github.com/claytercek)! - Introduces the new `@bluecadet/launchpad-controller` package, which provides a centralized controller architecture for Launchpad. End user APIs remain unchanged, with the controller used internally by the CLI for command execution in "task mode".

- [#268](https://github.com/bluecadet/launchpad/pull/268) [`fb70176`](https://github.com/bluecadet/launchpad/commit/fb70176e9bfda8194006b1e77d2f69b55a7df7e7) Thanks [@claytercek](https://github.com/claytercek)! - Move file logging config and logic to controller, and terminal logging to CLI. Refactor logging to use event bus, so logs are visible across processes.

  Also adds a SubsystemContext type to be shared across packages.

- [#262](https://github.com/bluecadet/launchpad/pull/262) [`29c2ccb`](https://github.com/bluecadet/launchpad/commit/29c2ccb6492270dad61bebc17c1f6a3f010bda45) Thanks [@claytercek](https://github.com/claytercek)! - Refactor package exports. Removed most re-exports from the index files, and added additional package export paths. Also refactored the launchpad meta package to generate export paths that match the individual packages. This updates nearly all import paths across the entire launchpad ecosystem.

- [#268](https://github.com/bluecadet/launchpad/pull/268) [`6f636b6`](https://github.com/bluecadet/launchpad/commit/6f636b6256d83b52600cf518e7d510712f3b5470) Thanks [@claytercek](https://github.com/claytercek)! - Refactor subsystems to be functional instead of classes. This allows for simpler logic and easier testing. No changes to the CLI, only the JS API.

### Minor Changes

- [#260](https://github.com/bluecadet/launchpad/pull/260) [`376ee60`](https://github.com/bluecadet/launchpad/commit/376ee6072f13fba86937a327cd14ba274f8ad972) Thanks [@claytercek](https://github.com/claytercek)! - Move declaration merging to utils package instead of controller package.

  This improves type safety when the controller package is not a dependency, such as when using content/monitor packages in isolation.

  The API stays largely the same, with some minor adjustments to import paths and type exports.

- [#270](https://github.com/bluecadet/launchpad/pull/270) [`74fc748`](https://github.com/bluecadet/launchpad/commit/74fc748901789bb0cca2986346c62db55a1a94d9) Thanks [@claytercek](https://github.com/claytercek)! - Unify subsystem and transport API.

- [#257](https://github.com/bluecadet/launchpad/pull/257) [`e254db8`](https://github.com/bluecadet/launchpad/commit/e254db82417a768847b942d2d10f6d101445f945) Thanks [@claytercek](https://github.com/claytercek)! - Adds 'start' command to CLI for starting launchpad controller in 'persistent' mode. This mode opens an IPC socket, allowing subsequent CLI commands to connect to the running controller instance. The command can be launched with the `-d/--detach` flag to run it in the background. Phase 2 of the multi-interface controller architecture.

- [#260](https://github.com/bluecadet/launchpad/pull/260) [`3495b26`](https://github.com/bluecadet/launchpad/commit/3495b266f16a5b9ada5457d5b1d884bac9bfc23f) Thanks [@claytercek](https://github.com/claytercek)! - Refactor monitor and content state to use Immer. This allows us to emit patch events when state changes, which are then handled by the controller package to sync state across processes (just IPC for now).

  Adds a new "watch" flag to the CLI status command to allow live monitoring of the controller status.

### Patch Changes

- [#260](https://github.com/bluecadet/launchpad/pull/260) [`634fa94`](https://github.com/bluecadet/launchpad/commit/634fa9490c50e2bfb638524d76c1bde3891aaee9) Thanks [@claytercek](https://github.com/claytercek)! - Move LaunchpadConfig type definition from cli package to utils package, allowing for declaration merging.

- [#261](https://github.com/bluecadet/launchpad/pull/261) [`34bc601`](https://github.com/bluecadet/launchpad/commit/34bc601fa694d529a55ad2c8f67443d04388ec3f) Thanks [@claytercek](https://github.com/claytercek)! - Fix invalid named pipe on windows

- [#269](https://github.com/bluecadet/launchpad/pull/269) [`9f47258`](https://github.com/bluecadet/launchpad/commit/9f47258763ac210a5982bad66bc17bfe98d239e3) Thanks [@claytercek](https://github.com/claytercek)! - Bump dependencies with vulnerabilities

- Updated dependencies [[`a9a2c10`](https://github.com/bluecadet/launchpad/commit/a9a2c1032f0b652aa07492e0867db3bdf5e6a520), [`634fa94`](https://github.com/bluecadet/launchpad/commit/634fa9490c50e2bfb638524d76c1bde3891aaee9), [`fb70176`](https://github.com/bluecadet/launchpad/commit/fb70176e9bfda8194006b1e77d2f69b55a7df7e7), [`9f47258`](https://github.com/bluecadet/launchpad/commit/9f47258763ac210a5982bad66bc17bfe98d239e3), [`29c2ccb`](https://github.com/bluecadet/launchpad/commit/29c2ccb6492270dad61bebc17c1f6a3f010bda45), [`6f636b6`](https://github.com/bluecadet/launchpad/commit/6f636b6256d83b52600cf518e7d510712f3b5470), [`376ee60`](https://github.com/bluecadet/launchpad/commit/376ee6072f13fba86937a327cd14ba274f8ad972), [`74fc748`](https://github.com/bluecadet/launchpad/commit/74fc748901789bb0cca2986346c62db55a1a94d9)]:
  - @bluecadet/launchpad-utils@3.0.0
