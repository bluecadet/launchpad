# Launchpad

Launchpad is a suite of tools for managing interactive installations. It manages content and monitors processes.

## Documentation

See the [Launchpad documentation](https://bluecadet.github.io/launchpad/) for guides and configuration options.

Read the [versioning and upgrade policy](./docs/guides/packages.md#versioning-and-upgrades) before upgrading. Each package, including the umbrella package, is versioned independently.

## Core packages

- [@bluecadet/launchpad-cli](./packages/cli): Command-line interface and configuration management
- [@bluecadet/launchpad-content](./packages/content): Content pipeline and transforms
- [@bluecadet/launchpad-controller](./packages/controller): Controller layer with multi-interface support
- [@bluecadet/launchpad-monitor](./packages/monitor): Process monitoring and management
- [@bluecadet/launchpad-observability](./packages/observability): Exports logs and metrics to external backends
- [@bluecadet/launchpad-scheduler](./packages/scheduler): Generic command scheduler plugin
- [@bluecadet/launchpad-utils](./packages/utils): Shared utilities
- [@bluecadet/launchpad](./packages/launchpad): Meta-package that installs all core packages
- [@bluecadet/create-launchpad](./packages/create): Scaffolding CLI for Launchpad projects

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## License

Bluecadet-authored Launchpad code is licensed under ISC. Third-party dependencies retain their own licenses.
