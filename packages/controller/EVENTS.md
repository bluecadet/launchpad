# Event Type Safety with Declaration Merging

## Overview

The controller's EventBus provides fully type-safe events through TypeScript's declaration merging feature. This allows subsystems to define their own event types without creating circular dependencies.

## How It Works

### 1. Controller Defines Base Events

The controller package exports a `LaunchpadEvents` **interface** (not a type):

```typescript
// packages/controller/src/core/event-bus.ts
export interface LaunchpadEvents {
  'command:start': { commandType: string };
  'command:success': { commandType: string; result?: unknown };
  'command:error': { commandType: string; error: Error };
  'system:shutdown': { code?: number; signal?: string };
  'system:error': { error: Error; context?: string };
}
```

### 2. Subsystems Augment via Declaration Merging

Each subsystem adds its own events by reopening the interface:

```typescript
// packages/content/src/content-events.ts
import type '@bluecadet/launchpad-controller';

declare module '@bluecadet/launchpad-controller' {
  interface LaunchpadEvents {
    'content:fetch:start': { sources?: string[]; timestamp: Date };
    'content:fetch:done': { sources: string[]; totalFiles: number };
    'content:fetch:error': { error: Error };
  }
}
```

```typescript
// packages/monitor/src/monitor-events.ts
import type '@bluecadet/launchpad-controller';

declare module '@bluecadet/launchpad-controller' {
  interface LaunchpadEvents {
    'monitor:app:started': { appName: string; pm2Id: number; pid: number };
    'monitor:app:stopped': { appName: string; pm2Id: number };
    'monitor:app:error': { appName: string; error: Error };
  }
}
```

### 3. Full Type Safety Everywhere

Now ALL code gets type safety:

```typescript
import { EventBus } from '@bluecadet/launchpad-controller';
import '@bluecadet/launchpad-content'; // Imports content event types

const eventBus = new EventBus();

// ✅ Type-safe emit - TypeScript knows the exact payload shape
eventBus.emit('content:fetch:start', {
  sources: ['sanity', 'contentful'],
  timestamp: new Date()
});

// ❌ Type error - missing required field
eventBus.emit('content:fetch:start', {
  sources: ['sanity']
  // Error: Property 'timestamp' is missing
});

// ❌ Type error - wrong field type
eventBus.emit('content:fetch:start', {
  sources: 'sanity', // Error: Type 'string' is not assignable to 'string[]'
  timestamp: new Date()
});

// ✅ Type-safe subscribe - data parameter is automatically typed
eventBus.on('content:fetch:start', (data) => {
  console.log(data.sources); // data is { sources?: string[]; timestamp: Date }
  console.log(data.timestamp.toISOString());
});

// ✅ Autocomplete works - IDE shows all available events
eventBus.on('content:fetch:' /* autocomplete shows all content:fetch:* events */);
```

## Benefits

### 1. No Circular Dependencies
- Controller doesn't depend on content/monitor
- Content/monitor can optionally depend on controller
- Works standalone or integrated

### 2. Co-located Types
- Event types live alongside the code that emits them
- Easy to find and maintain
- Single source of truth

### 3. Progressive Enhancement
- Without controller: Events work but are untyped
- With controller: Full type safety automatically
- No runtime overhead

### 4. Excellent DX
- Autocomplete for event names
- Type checking for payloads
- Inline documentation via JSDoc

## Usage in Subsystems

### Emitting Events

```typescript
import type { EventBus } from '@bluecadet/launchpad-utils';
import './content-events.js'; // Import to register event types

export class LaunchpadContent {
  private _eventBus?: EventBus;

  setEventBus(eventBus: EventBus): void {
    this._eventBus = eventBus;
  }

  async fetch(): Promise<void> {
    // Emit type-safe events
    this._eventBus?.emit('content:fetch:start', {
      sources: this._sources.map(s => s.id),
      timestamp: new Date()
    });

    try {
      // ... fetch logic ...

      this._eventBus?.emit('content:fetch:done', {
        sources: this._sources.map(s => s.id),
        totalFiles: result.fileCount,
        duration: Date.now() - startTime
      });
    } catch (error) {
      this._eventBus?.emit('content:fetch:error', {
        error: error as Error
      });
    }
  }
}
```

### Listening to Events

```typescript
import { LaunchpadController } from '@bluecadet/launchpad-controller';
import '@bluecadet/launchpad-content'; // Import content event types
import '@bluecadet/launchpad-monitor'; // Import monitor event types

const controller = new LaunchpadController(config, logger);
const eventBus = controller.getEventBus();

// Subscribe to specific events
eventBus.on('content:fetch:start', (data) => {
  console.log('Fetching from:', data.sources);
});

// Subscribe to event patterns
eventBus.onPattern(/^content:.*$/, (event, data) => {
  console.log(`Content event: ${event}`, data);
});

// Subscribe to all events
eventBus.onAny((event, data) => {
  logger.debug(`Event: ${event}`, data);
});
```

## Event Naming Conventions

### Namespacing
- Use subsystem prefix: `content:`, `monitor:`, `system:`
- Separate levels with colons: `content:source:start`

### Lifecycle Events
- `start` - Operation beginning
- `done` - Operation completed successfully
- `error` - Operation failed

### State Change Events
- Use past tense: `started`, `stopped`, `updated`
- Include relevant identifiers: `appName`, `sourceId`

### Example Patterns
```
content:fetch:start
content:fetch:done
content:fetch:error

content:source:start
content:source:done
content:source:error

monitor:app:started
monitor:app:stopped
monitor:app:error
```

## Testing

Events can be tested by subscribing to them:

```typescript
import { test, expect } from 'vitest';
import { EventBus } from '@bluecadet/launchpad-controller';
import '@bluecadet/launchpad-content';

test('content emits fetch events', async () => {
  const eventBus = new EventBus();
  const events: string[] = [];

  eventBus.on('content:fetch:start', () => events.push('start'));
  eventBus.on('content:fetch:done', () => events.push('done'));

  const content = new LaunchpadContent(config);
  content.setEventBus(eventBus);

  await content.fetch();

  expect(events).toEqual(['start', 'done']);
});
```

## Advanced: Custom Events

Users can define their own events without modifying the controller:

```typescript
// my-plugin.ts
declare module '@bluecadet/launchpad-controller' {
  interface LaunchpadEvents {
    'plugin:myPlugin:ready': { version: string };
    'plugin:myPlugin:error': { error: Error };
  }
}

// Now these events are type-safe everywhere
eventBus.emit('plugin:myPlugin:ready', { version: '1.0.0' });
```
