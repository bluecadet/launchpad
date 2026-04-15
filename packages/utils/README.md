# Launchpad Utils

Collection of utils used across [@bluecadet/launchpad](https://www.npmjs.com/package/@bluecadet/launchpad) packages.

## Plugin API Notes

`plugin-interfaces` now exposes the explicit plugin command contract used by the controller:

- `manifest.commands` for command registration
- `PluginContext` for controller-provided runtime services

Plugins should no longer rely on implicit command prefix routing. Hosts now declare orchestration explicitly with config-level workflows.
