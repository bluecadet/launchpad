# @bluecadet/launchpad-cli

Command-line interface for managing media installations with Launchpad. It manages content, monitors processes, and loads configuration.

## Documentation

See the [Launchpad documentation](https://bluecadet.github.io/launchpad/) for guides and configuration options.

## Installation

```bash
npm install @bluecadet/launchpad-cli

# Install additional modules as needed
npm install @bluecadet/launchpad-content @bluecadet/launchpad-monitor
```

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

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
