---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad": major
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-utils": major
"@bluecadet/launchpad-cli": major
---

Replaces the hook-based plugin system with a unified plugin model across all packages.

### Config shape

The top-level `content` and `monitor` keys are replaced by a `plugins` array:

```ts
// Before
{ content: { sources: [...] }, monitor: { apps: [...] } }

// After
import { content, monitor } from '@bluecadet/launchpad';
{ plugins: [content({ sources: [...] }), monitor({ apps: [...] })] }
```

### Renamed factory functions

- `createLaunchpadContent` → `content` (`@bluecadet/launchpad-content`)
- `createLaunchpadMonitor` → `monitor` (`@bluecadet/launchpad-monitor`)

### Content transforms

The `plugins` config field is renamed to `transforms`, and `ContentPlugin` / `ContentPluginDriver` are replaced by `ContentTransform`:

```ts
// Before
{ plugins: [sanityToHtml(), mediaDownloader()] }

// After
{ transforms: [sanityToHtml(), mediaDownloader()] }
```

Events renamed: `content:plugin:start/done/error` → `content:transform:start/done/error`; payload field `pluginName` → `transformName`.

### Monitor plugins removed

The `plugins` config field and `MonitorPlugin` / `MonitorPluginDriver` types are removed. Previously, monitor plugins received lifecycle callbacks (`beforeConnect`, `afterConnect`, `beforeAppStart`, `afterAppStart`, `onAppLog`, etc.) invoked by the driver. All of those lifecycle moments — and more — are now emitted as typed events on the shared event bus:

| Old hook | New event |
|---|---|
| `beforeConnect` / `afterConnect` | `monitor:connect:start` / `monitor:connect:done` |
| `beforeDisconnect` / `afterDisconnect` | `monitor:disconnect:start` / `monitor:disconnect:done` |
| `beforeAppStart` / `afterAppStart` | `monitor:app:start` / `monitor:app:started` |
| `beforeAppStop` / `afterAppStop` | `monitor:app:stop` / `monitor:app:stopped` |
| `onAppError` | `monitor:app:error` |
| `onAppLog` / `onAppErrorLog` | `monitor:app:log` / `monitor:app:errorLog` |
| `beforeShutdown` | `monitor:beforeShutdown` |

Additional events with no hook equivalent: `monitor:app:online`, `monitor:app:exit`, `monitor:app:crash`, `monitor:app:restart` / `monitor:app:restarted`, and Windows-specific `monitor:window:foreground` / `monitor:window:minimize` / `monitor:window:hide` / `monitor:window:error`.

```ts
// Before
{ plugins: [{ beforeAppStart: ({ appName }) => { ... }, onAppLog: ({ appName, data }) => { ... } }] }

// After
eventBus.on('monitor:app:start', ({ appName }) => { ... })
eventBus.on('monitor:app:log', ({ appName, data }) => { ... })
```

### Plugin author renames

`defineSubsystem` → `definePlugin`, `SubsystemConfig` → `PluginConfig`, `SubsystemContext` → `PluginContext`, `InstantiatedSubsystem` → `InstantiatedPlugin`. A new optional `startupCommands` field is added to `PluginConfig`.

`PluginDriver` and `HookContextProvider` are removed from `@bluecadet/launchpad-utils`. The new `definePlugin` model replaces the hook-based driver pattern entirely.

### Updated import paths

Most re-exports have been removed from index files in favor of explicit sub-path exports. Nearly all import paths across the ecosystem have changed — see each package's `package.json#exports` for the updated paths.

`@bluecadet/launchpad` (the meta package) now exposes sub-path exports that mirror the individual packages (e.g. `@bluecadet/launchpad/content/transforms/media-downloader`), replacing the previous flat re-export structure.

### New `@bluecadet/launchpad-controller` package

Provides a centralized controller used internally by the CLI for command execution. End-user APIs are unchanged.

### Logging

File logging config and logic move to the controller package; terminal logging moves to the CLI. Logs are now routed through the event bus, making them visible across processes.

### Subsystems are now functions

Plugins are functional instead of class-based, allowing for simpler logic and easier testing. No changes to the CLI — only to the JS API.

### Declaration merging

Declaration merging moves from the controller package to the utils package, improving type safety when the controller is not a direct dependency.
