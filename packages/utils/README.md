# Launchpad utils

Utilities shared across [@bluecadet/launchpad](https://www.npmjs.com/package/@bluecadet/launchpad) packages.

## Plugin API notes

`plugin-interfaces` exposes the explicit plugin command contract the controller uses:

- `manifest.commands` registers commands.
- `PluginContext` provides controller runtime services.

Plugins must not rely on implicit command prefix routing. Hosts declare orchestration with config-level workflows.

`PluginContext.logSource` optionally exposes the controller-owned canonical log source. The `./logging` export defines the contracts for the source, reader, checkpoint receipt, gap, normalized record, and resource. The controller owns physical file and checkpoint I/O, so plugins should consume the interface instead of inspecting the logging directory.

Fallible source and reader operations return `ResultAsync`, including `flush`, `createReader`, `read`, `ack`, and `close`. The canonical `normalizeLogRecord`, `serializeLogRecord`, and `parseLogRecord` helpers return `Result`; handle the error before using the record or serialized line.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
