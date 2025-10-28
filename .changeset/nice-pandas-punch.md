---
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
"@bluecadet/launchpad-cli": minor
---

Move declaration merging to utils package instead of controller package.

This improves type safety when the controller package is not a dependency, such as when using content/monitor packages in isolation.

The API stays largely the same, with some minor adjustments to import paths and type exports.

```typescript
// OLD:
import { LaunchpadEvents, SubsystemsState } from '@bluecadet/launchpad-controller';

// NEW:
import { LaunchpadEvents, SubsystemsState } from '@bluecadet/launchpad-utils';

// ------

// OLD: 

declare module '@bluecadet/launchpad-controller' {
  interface LaunchpadEvents {
    'plugin:myPlugin:ready': { version: string };
    'plugin:myPlugin:error': { error: Error };
  }

  interface SubsystemsState {
    myPlugin: MyPluginState;
  }
}

// NEW:
declare module '@bluecadet/launchpad-utils' {
  interface LaunchpadEvents {
    'plugin:myPlugin:ready': { version: string };
    'plugin:myPlugin:error': { error: Error };
  }
  interface SubsystemsState {
    myPlugin: MyPluginState;
  }
}
```
