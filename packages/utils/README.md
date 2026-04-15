# Launchpad Utils

Collection of utils used across [@bluecadet/launchpad](https://www.npmjs.com/package/@bluecadet/launchpad) packages.

## Plugin API Notes

`plugin-interfaces` now exposes the explicit plugin command contract used by the controller:

- `manifest.commands` for command registration
- `manifest.lifecycle.startupCommands` for explicit startup dispatch
- `PluginContext` for controller-provided runtime services

Plugins should no longer rely on implicit command prefix routing or top-level `startupCommands`.
