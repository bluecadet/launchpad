---
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
---

Introduce `EventBus<TEvents>` and per-package event types.

`EventBus<TEvents extends Record<string, unknown>>` is available from `@bluecadet/launchpad-utils`. The default `TEvents` is `Record<string, unknown>`, so untyped usage works out of the box. Plugins and custom integrations can create typed event buses scoped to their own event contracts.

Each plugin package exports its event types directly:
- `ContentEvents` from `@bluecadet/launchpad-content`
- `MonitorEvents` from `@bluecadet/launchpad-monitor`
- `CoreEvents` from `@bluecadet/launchpad-utils`
