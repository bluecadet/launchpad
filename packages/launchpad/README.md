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
- `@bluecadet/launchpad-controller`: Central orchestration and event system
- `@bluecadet/launchpad-scaffold`: System configuration

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

This is a meta-package that includes no code of its own. It simply installs all core Launchpad packages. For more targeted installations, you can install individual packages directly.

## License

ISC © Bluecadet
