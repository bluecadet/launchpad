# @bluecadet/launchpad

All-in-one package for building and managing interactive media installations. It installs every core Launchpad package at once.

## Documentation

See the [Launchpad documentation](https://bluecadet.github.io/launchpad/) for guides and configuration options.

## Installation

```bash
npm install @bluecadet/launchpad
```

This installs the core packages:

- `@bluecadet/launchpad-cli`: Command-line interface
- `@bluecadet/launchpad-content`: Content management
- `@bluecadet/launchpad-monitor`: Process monitoring
- `@bluecadet/launchpad-controller`: Central orchestration and canonical file logging
- `@bluecadet/launchpad-observability`: Optional endpoint-neutral log and metric delivery

## Basic usage

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

## Subpath exports

The package re-exports each core package through thin subpaths such as `@bluecadet/launchpad/content`, `@bluecadet/launchpad/monitor`, and `@bluecadet/launchpad/observability`. To install less, add individual packages directly.

Configured observability destinations default to checkpointed delivery from the controller's canonical JSONL. Set `logStorage: { type: 'memory' }` to opt out of retained log delivery.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
