---
"@bluecadet/launchpad": major
---

Introduces `StatusSnapshot` and `ctx.updateState()` for plugin status and state management.

### Status: `summarize()`

Plugins expose an optional `summarize?(state) => Section | null` property on the value returned by `definePlugin()`. It is a pure function over `LaunchpadState` — no chalk, no side effects.

```ts
definePlugin({
  setup(ctx) { /* ... */ },
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

The controller composes a `StatusSnapshot` from each plugin's `summarize` and exposes it over IPC via `client.queryStatusSnapshot()` and `client.onStatusSnapshotChange()`. The CLI's `formatSnapshot()` owns all chalk formatting.

`Tone`, `Row`, `Section`, and `StatusSnapshot` are exported from `@bluecadet/launchpad-utils/types`.

### State: `ctx.updateState()`

Plugins call `ctx.updateState(patch)` to establish and update their state slice. The controller lazily creates a scoped state store per plugin on first call, handling patch generation, versioning, and broadcasting across processes via Immer.

### CLI: `--watch` flag on `status`

`launchpad status --watch` streams live state updates from a running controller.
