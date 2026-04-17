---
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
"@bluecadet/launchpad-dashboard": minor
---

Make `EventBus` generic and export standalone plugin event types.

`EventBus` is now `EventBus<TEvents extends Record<string, unknown>>` with a default of `Record<string, unknown>`, removing its hard dependency on `LaunchpadEvents`. This allows plugins and custom integrations to create typed event buses scoped to their own event contracts.

Each plugin package now exports its event types directly:
- `ContentEvents` from `@bluecadet/launchpad-content`
- `MonitorEvents` from `@bluecadet/launchpad-monitor`
- `DashboardEvents` from `@bluecadet/launchpad-dashboard`
- `CoreEvents` from `@bluecadet/launchpad-utils`

The existing `LaunchpadEvents` and `PluginsState` interfaces are deprecated in favor of these granular types, but remain functional via declaration merging for backward compatibility.
