# @bluecadet/launchpad-controller

## 3.1.1

### Patch Changes

- [#309](https://github.com/bluecadet/launchpad/pull/309) [`92d2ba3`](https://github.com/bluecadet/launchpad/commit/92d2ba3a0e4496ef24ebb251bb899c32685fceb4) - Fix IPC serialization crashing on payloads devalue can't stringify ("Cannot stringify arbitrary non-POJOs"). Event and state payloads can carry class instances like airtable's `AirtableError` (which doesn't extend `Error`), functions, or promises. `IPCSerializer.serialize` now sanitizes the payload and retries on failure — error-likes become real Errors, class instances become plain objects — and can never throw.

- [#309](https://github.com/bluecadet/launchpad/pull/309) [`0aa5d60`](https://github.com/bluecadet/launchpad/commit/0aa5d601bd910614aa64041ac3da6c45ab27efc9) - Contain plugin code that throws synchronously or rejects its underlying promise. A plugin `executeCommand` that threw (instead of returning `errAsync`) unwound out of the command dispatcher into `ResultAsync.fromSafePromise` in the workflow runner, crashing the process; a throwing plugin `setup` similarly escaped `registerPlugin`. Both are now converted to err Results at the plugin boundary, so a faulty plugin fails its command or registration without taking launchpad down.

- Updated dependencies [[`13cfbe6`](https://github.com/bluecadet/launchpad/commit/13cfbe6ce9bb9efb7a3a3d5d16080538af040acf), [`3665436`](https://github.com/bluecadet/launchpad/commit/3665436402021470f2e9654e81fa978a8fe4daff), [`53fb2fc`](https://github.com/bluecadet/launchpad/commit/53fb2fc74cecd47b33585618a6b39d875d308b02)]:
  - @bluecadet/launchpad-utils@3.1.0

## 3.1.0

### Minor Changes

- [#301](https://github.com/bluecadet/launchpad/pull/301) [`109f9fb`](https://github.com/bluecadet/launchpad/commit/109f9fbffbf16de715eaa87635138ebeb64986d2) - Workflows now run every step best-effort instead of halting on the first failure. A failed step is recorded and the remaining steps still run; the workflow reports an aggregated error at the end. This means a failed `content.fetch` no longer prevents `monitor.start` from launching apps against the last successfully published content. Wrap a step as `{ step: 'command.id', stopOnError: true }` to opt into the old halt-on-failure behavior for that step.

### Patch Changes

- [#301](https://github.com/bluecadet/launchpad/pull/301) [`f03604e`](https://github.com/bluecadet/launchpad/commit/f03604ecfaa2675dcf6333f73c912733a9fb6d97) - Fix windows named pipe validation

## 3.0.1

### Patch Changes

- [#299](https://github.com/bluecadet/launchpad/pull/299) [`10e105d`](https://github.com/bluecadet/launchpad/commit/10e105d4c2d1102c846e5585a714b3e09fd1c147) - Fix libuv assertion error on Windows when closing IPC transport during shutdown by using `socket.destroy()` instead of `socket.end()`.

## 1.0.0

### Major Changes

- [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2) - Replaces the hook-based plugin system with a unified plugin model across all packages. See the `@bluecadet/launchpad` changelog for migration details.

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a) - Introduces `StatusSnapshot` and `ctx.updateState()` for plugin status and state management. See the `@bluecadet/launchpad` changelog for migration details.

### Minor Changes

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

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`b0925c8`](https://github.com/bluecadet/launchpad/commit/b0925c8552e39d23ab9eef76d91ea8cbc2782f92) - Fix invalid named pipe on windows

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d) - Bump dependencies with vulnerabilities

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789) - Remove `process.exit()` calls from library code.

  Library code should never terminate the host process. The monitor and IPC transport now emit a `system:shutdown` event on the event bus instead of calling `process.exit(0)` on graceful shutdown. The CLI handles this event and exits cleanly. Programmatic users of the monitor or controller who relied on the implicit exit should listen for `system:shutdown` instead.

- Updated dependencies [[`8d6cf1e`](https://github.com/bluecadet/launchpad/commit/8d6cf1e0b9ceccdf1cbdf586d6ed181301972789), [`b29a443`](https://github.com/bluecadet/launchpad/commit/b29a443decb554c89b708872ab056e831175040d), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a), [`ce098d3`](https://github.com/bluecadet/launchpad/commit/ce098d3508a7278ff201d3e50bb2e90fe49a1c3c), [`bde09a4`](https://github.com/bluecadet/launchpad/commit/bde09a41af069d7195fcebf467624a7cedca1de2), [`7debdda`](https://github.com/bluecadet/launchpad/commit/7debddaac84c3f3276d0dfdcb65c4b2ede44873a)]:
  - @bluecadet/launchpad-utils@3.0.0
