# @bluecadet/launchpad-controller

Controller layer for Launchpad, controllable through multiple interfaces.

## Features

- Type-safe event bus for communication between subsystems
- Explicit command registry: the controller registers commands from plugin manifests
- State store updated in real time through event subscriptions
- Pluggable transports for different connection types
- Task mode for ephemeral runs and persistent mode for long-running processes with transports
- Canonical logging: segmented JSONL, an optional human-readable text view, bounded retention, and checkpoints for observability

## Installation

```bash
npm install @bluecadet/launchpad-controller
```

## Lifecycle and ownership

`new LaunchpadController(...)` creates an unstarted controller and opens no files. The first `registerPlugin()` or `start()` call reserves the configured project identity before it opens logging or runs plugin setup. Both methods return `ResultAsync` errors for ownership contention and for filesystem or native-locking failures. Task and persistent controllers use the same lease.

Concurrent `start()` calls share one attempt. If startup fails, the controller aborts and disconnects registered plugins, then closes logging and releases ownership.

Always await `stop()` when disposing a controller, even one that never started or failed registration. Shutdown holds ownership until plugins and physical logging I/O settle. If the bounded logging-close wait times out, `stop()` can return while the project and log-directory leases remain held, and no other controller can start until the pending I/O settles. A stopped controller cannot restart; create a new instance for another run.

See the [controller reference](https://launchpad.bluecadet.com/reference/controller/#process-ownership) for lease-file and PID-file behavior.

## Logging

The controller alone owns local log normalization, redaction, files, rotation, retention, and the logging-directory lease. The default `.logs` directory holds canonical segmented JSONL and a text view of `info` and above, enabled by default. Configured observability destinations default to checkpointed delivery from the canonical source and create no sidecar spool.

See the [controller logging reference](https://launchpad.bluecadet.com/reference/controller/logging/) for configuration and migration details.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
