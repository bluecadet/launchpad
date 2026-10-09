# Launchpad Utils

Collection of utils used across [@bluecadet/launchpad](https://www.npmjs.com/package/@bluecadet/launchpad) packages.

## Plugin API Notes

`plugin-interfaces` now exposes the explicit plugin command contract used by the controller:

- `manifest.commands` for command registration
- `PluginContext` for controller-provided runtime services

Plugins should no longer rely on implicit command prefix routing. Hosts now declare orchestration explicitly with config-level workflows.

`PluginContext.logSource` optionally exposes the controller-owned canonical log source. The `./logging` export defines its source, reader, checkpoint receipt, gap, normalized-record, and resource contracts. Physical file and checkpoint I/O remain controller-owned; plugins should consume the interface rather than inspect the logging directory.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
