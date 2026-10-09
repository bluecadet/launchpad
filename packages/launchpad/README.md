# @bluecadet/launchpad

All-in-one package for building and managing interactive media installations. This package is a convenient way to install all core Launchpad packages at once.

## Documentation

For complete documentation, configuration options, and guides, visit:
[Launchpad Documentation](https://bluecadet.github.io/launchpad/)

## Installation

```bash
npm install @bluecadet/launchpad
```

This will install all core packages:

- `@bluecadet/launchpad-cli`: Command line interface
- `@bluecadet/launchpad-content`: Content management
- `@bluecadet/launchpad-monitor`: Process monitoring
- `@bluecadet/launchpad-controller`: Central orchestration and canonical file logging
- `@bluecadet/launchpad-observability`: Optional endpoint-neutral log and metric delivery

## Basic Usage

```bash
# Download content and start apps
npx launchpad start

# Only download fresh content
npx launchpad content

# Only manage apps
npx launchpad monitor

# Stop all processes
npx launchpad stop
```

## Note

This package installs the core Launchpad packages and provides thin subpath re-exports such as `@bluecadet/launchpad/content`, `@bluecadet/launchpad/monitor`, and `@bluecadet/launchpad/observability`. Configured observability destinations default to checkpointed delivery from the controller's canonical JSONL; `logStorage: { type: 'memory' }` opts out of retained log delivery. For more targeted installations, you can install individual packages directly.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
