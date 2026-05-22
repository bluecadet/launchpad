---
"@bluecadet/launchpad": major
---

Plugins can now declare CLI commands in their manifest. The hardcoded `content` and `monitor` CLI commands are removed and replaced with manifest declarations inside their respective plugins.

### Plugin-declared CLI commands

Third-party plugins can expose CLI commands by adding a `cli` field to their `PluginManifest`. The CLI loads plugin manifests at startup and registers declared commands as yargs commands — no CLI package changes needed.

```ts
definePlugin({
  name: "my-plugin",
  manifest: {
    commands: [{ id: "my-plugin.sync" }],
    cli: [
      {
        name: "sync",
        description: "Sync data",
        commands: [{ type: "my-plugin.sync" }],
        flags: {
          force: { type: "boolean", alias: "f", description: "Force re-sync" },
        },
      },
    ],
  },
  // ...
});
```

```bash
launchpad sync           # dispatches my-plugin.sync
launchpad sync --force   # dispatches { type: "my-plugin.sync", force: true }
```

Leaf commands support `flags` (typed options with `boolean`, `string`, or `number` types, including array flags) and `positionals` (ordered arguments, including variadic). Group commands nest subcommands under a parent name:

```ts
cli: [
  {
    name: "monitor",
    subcommands: [
      { name: "start", mode: "persistent", commands: [{ type: "monitor.connect" }, { type: "monitor.start" }] },
      { name: "stop",  mode: "task",       commands: [{ type: "monitor.stop" }] },
    ],
  },
],
```

The CLI exits with a descriptive error at startup if two plugins declare the same top-level command name. If the config file is missing or invalid, built-in commands (`start`, `stop`, `status`) remain available — plugin commands are silently absent.

### Breaking: `launchpad content` and `launchpad monitor` command changes

```bash
# Before
launchpad content         # fetch all content
launchpad monitor         # start monitor (persistent)

# After
launchpad content fetch   # fetch all content
launchpad monitor start   # start monitor (persistent)
launchpad monitor stop    # stop monitor
launchpad monitor restart # restart monitored apps
```
