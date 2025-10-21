# Contributing to Launchpad

## Getting Started

### Setup

```bash
# Clone the repository
git clone git@github.com:bluecadet/launchpad.git
cd launchpad

# Install dependencies for all packages
npm install
```

### Project Structure

Launchpad is organized as an npm workspaces monorepo:

```
packages/
├── cli/           # Command-line interface and configuration management
├── content/       # Content fetching and transformation pipeline
├── monitor/       # Process monitoring and management via PM2
├── scaffold/      # System configuration and Windows kiosk setup
├── utils/         # Shared utilities and base functionality
├── testing/       # Testing utilities and setup
└── launchpad/     # Meta-package that installs all core packages
```

## Project Architecture

### Core Concepts

**Launchpad** is a suite of tools for managing interactive installations. It provides:

- **Content Management**: Fetching and transforming data from CMSs/APIs into a SQLite-backed DataStore
- **Process Monitoring**: Managing long-running applications via PM2 with window management
- **System Configuration**: Windows kiosk setup and system-level configuration

### Monorepo Packages

#### @bluecadet/launchpad-cli
The main entry point that orchestrates the entire system. It:
- Loads and validates `launchpad.config.js` configuration
- Initializes the content, monitor, and scaffold subsystems
- Provides CLI commands for users

#### @bluecadet/launchpad-content
Handles content fetching and transformation:
- Manages multiple content sources (Airtable, Contentful, Sanity, Strapi, JSON)
- Executes a content pipeline: setup → backup → clear → fetch → transform → restore/cleanup
- Stores downloaded content in a SQLite-backed DataStore
- Plugins allow extensible content transformation

#### @bluecadet/launchpad-monitor
Manages application processes and lifecycle:
- Uses PM2 for process management
- Captures and routes application stdout/stderr
- Manages window state and z-order on Windows via platform-specific APIs
- Plugin system for reacting to app lifecycle events

#### @bluecadet/launchpad-scaffold
Handles Windows-specific system configuration and kiosk setup.

#### @bluecadet/launchpad-utils
Shared foundational utilities:
- Centralized logging via `LogManager` with hierarchical logger support
- Base `PluginDriver` for plugin lifecycle management
- Exit handling utilities for graceful shutdown
- Shared TypeScript configuration

### Configuration System

All config schemas use Zod for validation and are defined in:
- `packages/cli/src/launchpad-config.ts` - Top-level config schema
- `packages/controller/src/core/controller-config.ts` - Controller system schema
- `packages/content/src/content-config.ts` - Content system schema
- `packages/monitor/src/monitor-config.ts` - Monitor system schema

### Plugin System

Both content and monitor subsystems use a shared, extensible plugin architecture:

**Base Plugin Driver** (`packages/utils/src/plugin-driver.ts`):
- Generic plugin system with lifecycle hooks
- Plugins implement typed hook functions that run at specific lifecycle points
- Supports sequential and parallel hook execution
- Each plugin receives: logger, abort signal, and working directory in its context

**Content Plugins** (`packages/content/src/content-plugin-driver.ts`):
- Transform or process downloaded content
- Runs after content fetch, enabling custom post-processing

**Monitor Plugins** (`packages/monitor/src/core/monitor-plugin-driver.ts`):
- React to app lifecycle events
- Enable monitoring, logging, notifications, and custom app management

### Content Pipeline Flow

When content is fetched, the system follows this sequence:

1. **Setup**: Load sources from config, initialize plugins
2. **Backup** (optional): Backup existing downloads before fetching new content
3. **Clear**: Remove old downloads, respecting `keep` patterns from config
4. **Fetch**: Execute all source fetch functions in parallel
   - Sources return documents with `{ id, data }` structure
   - Data can be a Promise or AsyncIterable
   - Documents stored in the DataStore namespaced by source ID
5. **Transform**: Run content plugins on fetched content
6. **Restore**: On failure, restore from backup if enabled
7. **Cleanup**: Remove temporary and backup directories

**Content Sources** (`packages/content/src/sources/`):
- Must implement `ContentSource` interface with `id` and `fetch(context)` methods
- Receive a `FetchContext` with: logger, DataStore instance, and AbortSignal

**DataStore** (`packages/content/src/utils/data-store.ts`):
- filesystem-backed storage for downloaded content
- Organizes data by source ID (namespace) and document ID
- Handles JSON serialization and file writing automatically

### Process Monitoring Architecture

The monitor system manages applications via PM2 with three layers:

- **ProcessManager** (`core/process-manager.ts`): Low-level PM2 interface (connect, start, stop, list, get logs)
- **BusManager** (`core/bus-manager.ts`): Captures stdout/stderr from apps and routes to launchpad logs
- **AppManager** (`core/app-manager.ts`): High-level app lifecycle (start, stop, validate), window management

Each app is configured with:
- `pm2` config object (follows PM2 StartOptions)
- Optional `windows` config for foreground/minimize/hide behavior
- Optional `logging` config for stdout/stderr routing

## Development Guidelines

### Common Commands

```bash
# Build all packages
npm run build

# Watch mode for development
npm run dev

# Lint code with Biome
npm run lint

# Fix linting issues
npm run lint:fix

# Run all tests
npm test

# Run tests for specific package
npm test -w @bluecadet/launchpad-content

# Run tests matching a pattern
npm test -- <file-pattern>
```

### Branch Strategy

- **develop**: Primary development branch. All PRs should target this branch.
- **feature branches**: Create from `develop` with descriptive names (e.g., `feat/controller-mode`, `fix/content-timing`)

### Code Style

We use **Biome** for code linting and formatting. Before committing:

```bash
npm run lint:fix
```

Key style guidelines:
- Use TypeScript for all new code
- Follow existing code patterns in the package
- Add JSDoc comments for public APIs
- Use meaningful variable and function names
- Keep functions focused and testable

### File Organization

- Source code: `src/`
- Tests: `__tests__/` (colocated with source)
- Test utilities: `__tests__/test-utils.ts`
- Built output: `dist/`
- Configuration: `tsconfig.src.json`, `package.json`

## Error Handling with neverthrow

This codebase uses the [neverthrow](https://github.com/supermacro/neverthrow) library for functional error handling. **Never throw errors in production code**—always return a `Result` type.

### Why neverthrow?

- **Explicit error handling**: Errors are part of the function signature, making error cases visible at compile time
- **No unhandled promises**: Async operations return `ResultAsync`, preventing silent failures
- **Composable error chains**: Use `.andThen()`, `.map()`, `.orElse()` to build complex logic without nested try-catch
- **Type safety**: TypeScript enforces handling all error cases
- **Testability**: Functions with predictable, typed results are easier to test

## Testing

### Philosophy

- Tests are colocated with source code in `__tests__` directories
- Aim for high coverage of business logic and error cases
- Mock external dependencies (APIs, file system, PM2)
- Use realistic test data and scenarios

### Setup and Utilities

We use **Vitest** for testing. Custom setup is in `packages/testing/src/setup.ts` and utilities in `packages/testing/src/test-utils.ts`.

Content plugin tests have specialized utilities in `packages/content/src/plugins/__tests__/plugins.test-utils.ts`.

## Code Quality

### TypeScript

- Use strict mode (enabled by default in `tsconfig.src.json`)
- Annotate function parameters and return types

### Linting

```bash
# Check for issues
npm run lint

# Fix issues automatically
npm run lint:fix
```

Biome checks for:
- Unused imports
- Unreachable code
- Inconsistent naming
- Code style and formatting

### Building

```bash
# Build all packages
npm run build
```

## Testing the CLI with npm link

If you're developing Launchpad and want to test it as a dependency in another project, you can link all packages locally using npm workspaces. This allows you to make changes in launchpad and immediately test them in your project without publishing to npm.

### Setup

#### 1. Build Launchpad packages

From the launchpad repository root:

```bash
npm run build
```

#### 2. Link packages

Link each of the Launchpad packages. This creates a symlink to the local package in your project's `node_modules`.

```bash
# In launchpad repo
cd packages/cli
npm link
cd ../content
npm link
cd ../monitor
npm link
cd ../scaffold
npm link
cd ../utils
npm link
cd ../controller
npm link
cd ../launchpad
npm link

# In your test project
npm link @bluecadet/launchpad-cli @bluecadet/launchpad-content @bluecadet/launchpad-monitor @bluecadet/launchpad-scaffold @bluecadet/launchpad-utils @bluecadet/launchpad @bluecadet/launchpad-controller
```

### Development Workflow

Once linked, you can use watch mode to rebuild changes automatically:

```bash
# In launchpad repo
npm run dev
```

Any changes to TypeScript source files will be automatically compiled, and your test project will pick up the changes.

### Testing with a Real Config

Create a `launchpad.config.ts` in your test project:

```javascript
import { defineConfig } from '@bluecadet/launchpad-cli';

export default defineConfig({
  content: {
    sources: [],      // Add your content sources
    plugins: [],      // Add your plugins
  },
  monitor: {
    apps: [],         // Add your apps to monitor
    plugins: [],      // Add your plugins
  },
});
```

Then run the CLI:

```bash
npx launchpad content
npx launchpad monitor
```

### Unlinking

When you're done testing, unlink the packages:

```bash
# In your test project
npm unlink @bluecadet/launchpad-cli @bluecadet/launchpad-content @bluecadet/launchpad-monitor @bluecadet/launchpad-scaffold @bluecadet/launchpad-utils @bluecadet/launchpad @bluecadet/launchpad-controller
```

### Troubleshooting

**Issue: Changes aren't being picked up**
- Make sure `npm run build` or `npm run dev` is running in the launchpad repo
- Check that the link is correctly set up by running `npm link` again in the package directory
- Clear your test project's node_modules cache: `rm -rf node_modules/.cache`

**Issue: TypeScript errors in test project**
- Ensure the test project has TypeScript and the Launchpad types are available
- Run `npm install` in both the launchpad repo and test project to ensure types are synced

**Issue: Module resolution errors**
- Verify the package names are correct
- Try removing and re-creating the links

## Creating Changesets

If you're contributing a user-facing change, create a changeset:

```bash
npm run changeset
```

Follow the prompts to:
1. Select which package(s) are affected
2. Choose change type: major, minor, or patch
3. Write a description of the change

### Changeset Guidelines

- **What to include**: User-facing changes, bug fixes, new features, breaking changes
- **What to skip**: test-only changes, documentation updates (usually)
- **Format**: Use markdown. First line must be plain text (no headings—GitHub release notes don't support this)
- **Examples**:
  - ✅ "Fix content pipeline crash when source timeout occurs"
  - ✅ "Add `maxRetries` config option to content sources"
  - ❌ "Fix typo in variable name"

### Non-Packages

Don't create changesets for:
- Examples and demo projects
- Test utilities and test files
- Documentation updates
- Development tooling changes

## Releases

### Release Process

1. **Create changeset**: Include with your PR when adding user-facing changes
2. **Open PR**: Open a PR against `develop`
3. **Merge PR**: Once approved, merge the PR into `develop`
4. **Wait for Version PR**: The [Changesets GitHub action](https://github.com/changesets/action#with-publishing) automatically creates a "Version Packages" PR
5. **Review and merge**: Review the version bumps and changelog, then merge the PR
6. **Automatic publish**: npm packages are automatically published to the npm registry

### Branch Management

- **develop**: Primary development branch. All PRs target this branch.

## Best Practices

### General Principles

1. **Explicit over implicit**: Write clear, self-documenting code
2. **Fail fast**: Validate inputs early and return errors explicitly
3. **Type safety**: Leverage TypeScript's type system to prevent bugs
4. **Composition over inheritance**: Use plugin architecture and utility functions
5. **Logging**: Add context-aware logging for debugging and monitoring

### Exit Handling

Use the `onExit()` utility from `@bluecadet/launchpad-utils` to register cleanup handlers:

```typescript
import { onExit } from '@bluecadet/launchpad-utils';

onExit(async (signal) => {
  // Clean up resources
  // Called on SIGINT, SIGTERM, or uncaught exceptions
  await cleanup();
});
```

### Abort Signals

All long-running operations receive an `AbortSignal`. Always check and respect it:

```typescript
export async function fetchData(context: FetchContext) {
  const { abortSignal, logger } = context;

  try {
    // Poll for data with abort check
    while (!abortSignal.aborted) {
      const data = await fetchNextBatch();
      yield { id: `item-${data.id}`, data };
    }
  } catch (error) {
    if (abortSignal.aborted) {
      logger.debug('Operation aborted');
      return;
    }
    throw error;
  }
}
```

### Testing Private Functions

If you need to test internal helpers, consider:
1. Making them testable through public APIs
2. Exporting them for testing only with a clear naming convention
3. Keeping the function scope small enough that it's implicitly tested

### Documentation

- Add JSDoc comments to all exported functions and types
- Include usage examples in complex modules
- Document plugin hooks and their lifecycle
- Keep README files up to date for each package
- User API changes should be documented in the /docs site

---

## Questions?

- Check existing tests for examples
- Look at similar modules for patterns
- Ask in PRs or open discussions
