---
title: "@bluecadet/launchpad-controller"
---

<script setup>
  import PackageHeader from '../../components/PackageHeader.vue'
</script>

<PackageHeader package="controller" />

The controller package provides a central orchestration layer for managing Launchpad subsystems (content and monitor). It enables command dispatching, event broadcasting, and state aggregation across all subsystems.

## Features

- **Central Orchestration**: Single point of control for all subsystems
- **Event Bus**: Type-safe event system with declaration merging
- **State Management**: Aggregated state from all subsystems
- **Command Dispatching**: Route commands to appropriate subsystems
- **Task Mode**: Ephemeral controller instances for one-off CLI operations
- **Persistent Mode**: Long-running controller with IPC socket for CLI integration
- **IPC Communication**: Type-safe command execution and state queries over Unix sockets

## Installation

```bash
npm install @bluecadet/launchpad-controller
```

## Architecture

### Core Components

#### LaunchpadController
The main orchestrator class that manages subsystems and coordinates their interactions.

```typescript
import { LaunchpadController } from '@bluecadet/launchpad-controller';

const controller = new LaunchpadController(config, logger);

// Register subsystems
controller.registerSubsystem('content', contentInstance);
controller.registerSubsystem('monitor', monitorInstance);

// Start the controller
await controller.start();
```

#### EventBus
Type-safe event system that enables communication between subsystems.

```typescript
const eventBus = controller.getEventBus();

// Listen to events
eventBus.on('content:fetch:done', (data) => {
  console.log(`Fetched ${data.sources.length} sources`);
});

// Emit events (from subsystems)
eventBus.emit('content:fetch:start', { timestamp: new Date() });
```

See the [Events Reference](./events.md) for all available events and their payloads.

#### StateStore
Aggregates state from all registered subsystems.

```typescript
const state = controller.getState();
console.log(state.content?.isFetching);
console.log(state.monitor?.isConnected);
```

#### CommandDispatcher
Routes commands to the appropriate subsystem based on command type.

```typescript
await controller.executeCommand({
  type: 'content.fetch',
  sources: ['sanity']
});

await controller.executeCommand({
  type: 'monitor.start',
  appNames: ['my-app']
});
```

## Integration with Subsystems

Subsystems integrate with the controller through duck-typed interfaces:

```typescript
interface Subsystem<TCommand, TState> = Partial<
  EventBusAware &        // Receive EventBus instance
  CommandExecutor<TCommand> &  // Execute commands
  StateProvider<TState> &      // Provide state
  Disconnectable              // Clean disconnect
>;
```

### EventBusAware
Subsystems that emit events implement `setEventBus()`:

```typescript
interface EventBusAware {
  setEventBus(eventBus: EventBus): void;
}
```

### CommandExecutor
Subsystems that handle commands implement `executeCommand()`:

```typescript
interface CommandExecutor<TCommand> {
  executeCommand(command: TCommand): ResultAsync<unknown, Error>;
}
```

### StateProvider
Subsystems that expose state implement `getState()`:

```typescript
interface StateProvider<TState> {
  getState(): TState;
}
```

### Disconnectable
Subsystems that need cleanup implement `disconnect()`:

```typescript
interface Disconnectable {
  disconnect(): ResultAsync<void, Error>;
}
```

## Usage Modes

### Task Mode
Ephemeral controller instances for one-off operations:

1. Create controller in task mode
2. Register subsystems
3. Start controller
4. Execute command(s)
5. Stop controller

This mode is used when no persistent controller is running, allowing the CLI to operate independently.

### Persistent Mode
Long-running controller that stays active to handle multiple commands:

- Started with `launchpad start` (optionally detached with `-d`)
- Opens IPC socket for inter-process communication
- Stores PID in a file for tracking
- Handles multiple CLI commands without reinitializing
- Gracefully shuts down with `launchpad stop`

Subsequent `launchpad` commands (content, monitor, status) detect the running controller and communicate with it via IPC instead of creating ephemeral instances.

#### Benefits

- **Faster command execution**: No initialization overhead for subsequent commands
- **Shared state**: All commands operate against the same controller instance
- **Detached mode**: Can run in background with `-d` flag
- **IPC protocol**: Type-safe command execution and state queries
- **Graceful shutdown**: Multi-stage shutdown with IPC fallbacks (SIGTERM → SIGKILL)

## Type Safety

The controller uses TypeScript declaration merging to provide type-safe events without circular dependencies:

```typescript
// Each subsystem declares its events
declare module '@bluecadet/launchpad-utils' {
  interface LaunchpadEvents {
    'content:fetch:start': { timestamp: Date };
    'monitor:app:started': { appName: string; pid: number };
  }
}
```

See the [Events documentation](./events.md) for more details on the type-safe event system.

## Error Handling

The controller uses `neverthrow` for robust error handling:

- Type-safe error management
- Clear error boundaries
- Graceful failure recovery
- Error event emission
