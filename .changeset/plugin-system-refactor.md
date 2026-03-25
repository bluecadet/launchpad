---
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-utils": major
"@bluecadet/launchpad-cli": major
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad": major
---

Replaces the hook-based plugin system with a unified plugin model across all packages.

## Breaking Changes

### Config shape (`@bluecadet/launchpad-cli`)

The top-level `content` and `monitor` keys are replaced by a `plugins` array using factory functions:

```ts
// Before
{ content: { sources: [...] }, monitor: { apps: [...] } }

// After
import { content, monitor } from '@bluecadet/launchpad';
{ plugins: [content({ sources: [...] }), monitor({ apps: [...] })] }
```

### Content transforms (`@bluecadet/launchpad-content`)

The `plugins` config field is renamed to `transforms`, and `ContentPlugin` / `ContentPluginDriver` are replaced by `ContentTransform`:

```ts
// Before
import { createLaunchpadContent } from '@bluecadet/launchpad-content';
{ plugins: [sanityToHtml(), mediaDownloader()] }

// After
import { content } from '@bluecadet/launchpad-content';
{ transforms: [sanityToHtml(), mediaDownloader()] }
```

Events renamed: `content:plugin:start/done/error` → `content:transform:start/done/error`; payload field `pluginName` → `transformName`.

### Monitor plugins (`@bluecadet/launchpad-monitor`)

The `plugins` config field and `MonitorPlugin` / `MonitorPluginDriver` types are removed. Subscribe to monitor lifecycle events on the shared event bus instead: `monitor:app:log`, `monitor:app:errorLog`, `monitor:beforeShutdown`.

### Renamed exports

- `createLaunchpadContent` → `content` (`@bluecadet/launchpad-content`)
- `createLaunchpadMonitor` → `monitor` (`@bluecadet/launchpad-monitor`)
- `PluginDriver` removed from `@bluecadet/launchpad-utils`

### Controller renames (`@bluecadet/launchpad-controller`)

`SubsystemConfig` → `PluginConfig`, `InstantiatedSubsystem` → `InstantiatedPlugin`, `SubsystemContext` → `PluginContext`, `defineSubsystem` → `definePlugin`, `registerSubsystem` → `registerPlugin`, `getSubsystem` → `getPlugin`. A new optional `startupCommands` field is added to `PluginConfig`.
