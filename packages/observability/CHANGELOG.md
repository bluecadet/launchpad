# @bluecadet/launchpad-observability

## 4.0.1

### Patch Changes

- Restore option descriptions in editor hovers and autocomplete for `launchpad.config.ts`. Config types are now documented interfaces, so their JSDoc survives into the published type declarations. ([#330](https://github.com/bluecadet/launchpad/pull/330))
- Updated dependencies:
  - @bluecadet/launchpad-utils@4.1.0

## 4.0.0

### Major Changes

- Run Launchpad and the scaffolder on Node.js 24.x or 26 and later (`^24 || >=26`), now required for the content cache's built-in `node:sqlite`. Check your project's Node range: generated projects declare it, but updates preserve existing declarations. ([#322](https://github.com/bluecadet/launchpad/pull/322))
  
  The shared file lease is also exported at `@bluecadet/launchpad-utils/native-file-lease`.
- Send logs and current-state gauges to endpoints you choose, with optional resource attributes and OTLP/HTTP JSON or protobuf encoding. Generated projects keep export opt-in and endpoint-gated; legacy log transports remain supported.
  
  Breaking public types: `LogEntry` fields are readonly, and `ObservabilityConfig` is now a union. Stop mutating entries and narrow the config variant before accessing `transports`, which isn't present in destination mode. These changes also apply through the umbrella exports.

### Minor Changes

- Observability destinations now resume retained log delivery after restarts; `logStorage: { type: 'memory' }` opts out.
  
  Before upgrading:
  
  - Use age-based `logging.maxFiles` (e.g. `'28d'`), not counts. Resolved `logging.maxSize` and `logging.maxFiles` are numeric bytes and milliseconds, respectively.
  - Update file tooling: JSONL and optional `.log` segments replace `launchpad-info`, `launchpad-debug`, and `launchpad-error`. Old files remain untouched.
  - Custom exporters need stable `checkpointKey` and `exportCanonical(batch, context)` handling normalized records and historical resource snapshots, or explicit memory delivery. Legacy `transports` reject either `logStorage` value.

### Patch Changes

- Updated dependencies:
  - @bluecadet/launchpad-utils@4.0.0

## 3.0.2

### Patch Changes

- Updated dependencies [[`42a9068`](https://github.com/bluecadet/launchpad/commit/42a9068d3c4a787715153745fecee84873eaedaa)]:
  - @bluecadet/launchpad-utils@3.2.0

## 3.0.1

### Patch Changes

- Updated dependencies [[`13cfbe6`](https://github.com/bluecadet/launchpad/commit/13cfbe6ce9bb9efb7a3a3d5d16080538af040acf), [`3665436`](https://github.com/bluecadet/launchpad/commit/3665436402021470f2e9654e81fa978a8fe4daff), [`53fb2fc`](https://github.com/bluecadet/launchpad/commit/53fb2fc74cecd47b33585618a6b39d875d308b02)]:
  - @bluecadet/launchpad-utils@3.1.0

## 3.0.0

### Major Changes

- [#294](https://github.com/bluecadet/launchpad/pull/294) [`4396230`](https://github.com/bluecadet/launchpad/commit/4396230cdeba0a2c745a71bade43d3e83656c372) - Add new observability plugin for log batching and aggregation.
