# @bluecadet/launchpad-cli

Command line interface for managing media installations with Launchpad. Provides commands for content management, process monitoring, and system configuration.

## Documentation

For complete documentation, configuration options, and guides, visit:
[Launchpad Documentation](https://bluecadet.github.io/launchpad/)

## Installation

```bash
npm install @bluecadet/launchpad-cli

# Install additional modules as needed
npm install @bluecadet/launchpad-content @bluecadet/launchpad-monitor
```

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

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
