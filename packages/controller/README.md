# @bluecadet/launchpad-controller

Controller layer for Launchpad with multi-interface control support.

## Features

- **Event Bus**: Type-safe event system for inter-subsystem communication
- **Explicit Command Registry**: Controller-owned command registration via plugin manifests
- **State Store**: Real-time state management via event subscriptions
- **Transport System**: Pluggable transports for various connection types
- **Task & Persistent Modes**: Ephemeral execution or long-running with transports
- **Canonical Logging**: Segmented JSONL, an optional human-readable text view, bounded retention, and checkpoint support for observability

## Installation

```bash
npm install @bluecadet/launchpad-controller
```

## Lifecycle and ownership

`new LaunchpadController(...)` creates an unstarted controller without opening files. The first `registerPlugin()` or `start()` reserves the configured project identity before opening logging or running plugin setup. These methods return `ResultAsync` errors for ownership contention and filesystem or native-locking failures. Task and persistent controllers use the same lease.

Concurrent `start()` calls share one attempt. Failed startup aborts and disconnects registered plugins before closing logging and releasing ownership. Always await `stop()` when disposing a controller, even if it was never started or registration failed. Shutdown keeps ownership until plugins and physical logging I/O have settled. If the bounded logging-close wait times out, `stop()` may finish while the project and log-directory leases remain held; another controller cannot start until the pending I/O settles. A stopped controller cannot be restarted; create a new instance for another run.

See the [controller reference](https://launchpad.bluecadet.com/reference/controller/#process-ownership) for lease-file and PID-file behavior.

## Logging

The controller is the single owner of local log normalization, redaction, files, rotation, retention, and the logging-directory lease. The default `.logs` directory contains canonical segmented JSONL plus a default-on text view at `info` and above. Configured observability destinations default to checkpointed delivery from the canonical source without creating a sidecar spool.

See the [controller logging reference](https://launchpad.bluecadet.com/reference/controller/logging/) for configuration and migration details.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
