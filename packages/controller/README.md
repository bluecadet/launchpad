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

## Logging

The controller is the single owner of local log normalization, redaction, files, rotation, retention, and the logging-directory lease. The default `.logs` directory contains canonical segmented JSONL plus a default-on text view at `info` and above. Configured observability destinations default to checkpointed delivery from the canonical source without creating a sidecar spool.

See the [controller logging reference](https://launchpad.bluecadet.com/reference/controller/logging/) for configuration and migration details.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
