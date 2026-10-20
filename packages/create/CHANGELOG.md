# @bluecadet/create-launchpad

## 4.0.1

### Patch Changes

- Add `.logs/` to the `.gitignore` entries written by the scaffolder. ([#328](https://github.com/bluecadet/launchpad/pull/328))
- Install `@types/node` as a dev dependency in scaffolded projects so `process.env` and other Node APIs type-check in `launchpad.config.ts`. ([#328](https://github.com/bluecadet/launchpad/pull/328))

## 4.0.0

### Major Changes

- Run Launchpad and the scaffolder on Node.js 24.x or 26 and later (`^24 || >=26`), now required for the content cache's built-in `node:sqlite`. Check your project's Node range: generated projects declare it, but updates preserve existing declarations. ([#322](https://github.com/bluecadet/launchpad/pull/322))
  
  The shared file lease is also exported at `@bluecadet/launchpad-utils/native-file-lease`.

### Minor Changes

- Observability destinations now resume retained log delivery after restarts; `logStorage: { type: 'memory' }` opts out.
  
  Before upgrading:
  
  - Use age-based `logging.maxFiles` (e.g. `'28d'`), not counts. Resolved `logging.maxSize` and `logging.maxFiles` are numeric bytes and milliseconds, respectively.
  - Update file tooling: JSONL and optional `.log` segments replace `launchpad-info`, `launchpad-debug`, and `launchpad-error`. Old files remain untouched.
  - Custom exporters need stable `checkpointKey` and `exportCanonical(batch, context)` handling normalized records and historical resource snapshots, or explicit memory delivery. Legacy `transports` reject either `logStorage` value.
- Send logs and current-state gauges to endpoints you choose, with optional resource attributes and OTLP/HTTP JSON or protobuf encoding. Generated projects keep export opt-in and endpoint-gated; legacy log transports remain supported.
  
  Breaking public types: `LogEntry` fields are readonly, and `ObservabilityConfig` is now a union. Stop mutating entries and narrow the config variant before accessing `transports`, which isn't present in destination mode. These changes also apply through the umbrella exports.

## 3.1.1

### Patch Changes

- [#311](https://github.com/bluecadet/launchpad/pull/311) [`42a9068`](https://github.com/bluecadet/launchpad/commit/42a9068d3c4a787715153745fecee84873eaedaa) - Add `httpTransport`, an HTTP/SSE push transport for non-Node consumers like browsers and Unity. It streams bus events over `GET /events`, dispatches allowlisted commands via `POST /command`, and serves display-oriented status over `GET /status` (plus an opt-in `GET /state`). It's best-effort sugar alongside the existing IPC transport — the `manifest.json` poll contract remains authoritative.

  `GET /events` replays a catch-up backlog to newly-connected clients: for each event name listed in the new `replayEvents` option (default `["content:version:promoted"]`), the transport remembers that event's last emitted frame and replays it, in last-emission order, before streaming live. Replayed events must also pass the `events` filter; everything else streams live only.

  Add a `ready()` plugin lifecycle phase (`Readyable` in `@bluecadet/launchpad-utils/plugin-interfaces`): after all plugins finish `setup()`, the controller calls `ready()` on each one, in registration order. A `ready()` that fails or throws is logged and contained. Plugins registered later get their `ready()` right away. `@bluecadet/launchpad-cli` calls `controller.ready()` in both its `start` and plugin-command paths.

  `@bluecadet/launchpad-content` uses `ready()` to re-emit `content:version:promoted` when a version is already active on disk at startup, so anything listening (including a freshly-connected `httpTransport` client) learns the active version without waiting for the next fetch.

  `ControllerMode` moves from `@bluecadet/launchpad-controller` to `@bluecadet/launchpad-utils`, re-exported from `@bluecadet/launchpad-controller/config` — no consumer changes needed.

  The `create` scaffold now hints at `httpTransport()` in generated Launchpad configs.

## 3.1.0

### Minor Changes

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`7494861`](https://github.com/bluecadet/launchpad/commit/7494861d4cd1fdb4f041bc84f78d57581bd981e8) - Add a Scheduler option to the plugin prompt. When selected, the generated config imports `scheduler` from `@bluecadet/launchpad/scheduler`, adds a `scheduler({ 'content.fetch': '15m' })` entry with a link to the live content refresh guide, and adds `@bluecadet/launchpad-scheduler` to the generated dependencies. When Content is selected, the generated content config now also includes a commented-out `// versioning: true,` hint pointing at the same guide.

### Patch Changes

- [#310](https://github.com/bluecadet/launchpad/pull/310) [`72e1ee7`](https://github.com/bluecadet/launchpad/commit/72e1ee772a035cb55baa7b7944db9502377d3423) - The generated scheduler config now includes a comment pointing at `refetchChecker` and the `refetch.check` command for fast schedules.

## 1.1.0

### Minor Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`076eb64`](https://github.com/bluecadet/launchpad/commit/076eb640ecc2fd6db3d19e6ca4205df8eaf54bcc) - Introduces `@bluecadet/create-launchpad`, a scaffolding CLI invoked via `npm create @bluecadet/launchpad`. Interactively guides users through selecting plugins (content, monitor), sources, and transforms, then generates or patches `package.json`, `tsconfig.json`, `launchpad.config.ts`, and `.gitignore`.
