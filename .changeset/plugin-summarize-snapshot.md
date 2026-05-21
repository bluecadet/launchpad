---
"@bluecadet/launchpad-utils": major
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad-cli": major
"@bluecadet/launchpad-content": major
"@bluecadet/launchpad-monitor": major
"@bluecadet/launchpad-dashboard": major
---

Replace the plugin status-contribution mechanism with a structured `StatusSnapshot` over IPC.

Previously, plugins shipped a renderer to the CLI by calling `ctx.statusRegistry.contributeStatusSection({ order, render })` during `setup()`. The CLI then re-ran each plugin's `setup()` against a stubbed context just to harvest that registration, and built-in plugins bypassed the registry entirely via hard-coded dynamic imports. Plugins emitted chalk-formatted ANSI strings, so non-terminal consumers (dashboards, future TUIs) could not reuse the contract.

The new shape:

- Plugins expose an optional `summarize?(state) => Section | null` property on the value returned by `definePlugin({...})`. It is a pure function over `LaunchpadState`.
- The controller composes a `StatusSnapshot` ({ header, sections[] }) from each plugin's `summarize` and exposes two IPC methods: `client.queryStatusSnapshot()` and `client.onStatusSnapshotChange()`.
- The wire format is structured data — sealed `Row` variants (`kv | list | text`) with an optional `tone`. The CLI's new `formatSnapshot()` owns all `chalk` formatting.

### Breaking changes

- `@bluecadet/launchpad-utils`:
  - `StatusRegistry` and the `./status-registry` export path are removed.
  - `StatusHostContext` is removed; `HostAwarePluginContext` no longer includes it (only `DashboardHostContext` remains).
  - `Tone`, `Row`, `Section`, and `StatusSnapshot` are added to `./types`.
  - `PluginConfig` gains an optional `summarize?(state): Section | null`.

- `@bluecadet/launchpad-content`, `-monitor`, `-dashboard`: the `contentStatusSection`, `monitorStatusSection`, and `dashboardStatusSection` named exports are removed.

- `@bluecadet/launchpad-controller`:
  - `LaunchpadController#getStatusRegistry()` is removed.
  - The IPC transport requires a `getStatusSnapshot` option.

### Migration

Plugins that previously called `ctx.statusRegistry.contributeStatusSection(section)` inside `setup()` should move that logic into a `summarize` property on the plugin factory's return value:

```ts
// Before
definePlugin({
  name: "myPlugin",
  setup(ctx: HostAwarePluginContext<MyState>) {
    ctx.statusRegistry.contributeStatusSection({
      order: 20,
      render: (state) => state.plugins.myPlugin
        ? chalk.bold("My Plugin:\n") + `  Phase: ${state.plugins.myPlugin.phase}`
        : null,
    });
    // ...
  },
});

// After
definePlugin({
  name: "myPlugin",
  setup(ctx) { /* unchanged */ },
  summarize(state): Section | null {
    const s = state.plugins.myPlugin;
    if (!s) return null;
    return {
      name: "myPlugin",
      order: 20,
      title: "My Plugin",
      rows: [{ type: "kv", label: "Phase", value: s.phase }],
    };
  },
});
```

Plugins that only contributed status (not dashboard) can drop the `HostAwarePluginContext` type and use the base `PluginContext<TState>` directly.
