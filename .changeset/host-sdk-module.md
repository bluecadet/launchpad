---
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-content": patch
"@bluecadet/launchpad-monitor": patch
"@bluecadet/launchpad-dashboard": patch
---

Add `@bluecadet/launchpad-utils/host-sdk` export path with host-specific context types.

The base `PluginContext` is now host-agnostic — it no longer bundles `dashboardRegistry` or `statusRegistry`. Plugins that contribute to dashboard panels or CLI status sections must explicitly declare their dependency by typing their `setup()` context parameter with the host extensions:

```ts
import type { HostAwarePluginContext } from "@bluecadet/launchpad-utils/host-sdk";

definePlugin({
  setup(ctx: HostAwarePluginContext<MyState>) {
    ctx.dashboardRegistry.addPanel(...);
    ctx.statusRegistry.addSection(...);
  }
});
```

Three types are exported from `host-sdk`:
- `DashboardHostContext` — provides `dashboardRegistry`
- `StatusHostContext` — provides `statusRegistry`
- `HostAwarePluginContext<TState>` — convenience alias combining both with `PluginContext<TState>`
