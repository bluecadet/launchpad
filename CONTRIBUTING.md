# Contributing to Launchpad

## Getting Started

### Setup

Repository development requires Node.js 24 or 26 and later (`^24 || >=26`), including for the Changesets release tooling. This development requirement does not change the supported runtime baseline of published packages.

```bash
# Clone the repository
git clone git@github.com:bluecadet/launchpad.git
cd launchpad

# Install dependencies for all packages
npm install
```

The monitor's Windows window-management addon is checked in as precompiled x64 and arm64 binaries, so installing dependencies or building TypeScript does not require Python, MSVC, or Zig. A previous arm64 prebuild passed a manual Windows arm64 smoke check before the switch to generated Node import libraries; the current prebuilds still need Windows runtime validation.

### Rebuilding and verifying the Windows addon

Only maintainers changing the native addon need the pinned Zig toolchain. Native binaries are rebuilt manually, not during `npm install`. Follow the [native addon README](./packages/monitor/native/README.md) for the exact build command, toolchain version, and Windows verification procedure. Commit both the source changes and rebuilt prebuilds.

The **Native binary drift** CI job rebuilds when changes touch `packages/monitor/native/**`, `packages/monitor/prebuilds/**`, or `.github/workflows/ci.yml`; unrelated changes skip it. Manual workflow dispatches and change-detection failures always rebuild. Ordinary lint, CI, and native packaging checks remain unchanged and run regardless of the native path filter.

Run the Windows-only smoke tests against the real bundled addon from the repository root:

```sh
npx vitest run packages/monitor/src/utils/__tests__/windows-native.windows.test.ts
```

They use a disposable PowerShell/.NET Windows Forms window, without addon mocks or added consumer dependencies. Prerequisites are Windows x64 or arm64 with a matching Node architecture, built-in Windows PowerShell 5.1, and policies allowing .NET Windows Forms and `Add-Type`. No Python, MSVC, or Zig is needed to run the tests. The suite checks enumeration, the exact title, minimize and hide independently observed through Win32 state, live mismatched-PID no-ops, and stale descriptors after fixture termination. Non-Windows platforms skip; addon-load or fixture failures on supported Windows fail rather than skip.

The existing `windows-latest` CI job discovers the tests normally through Vitest and currently covers x64 only; arm64 needs a separate Windows arm64 run. Foreground remains a manual/best-effort check because of Windows focus restrictions.

Before release, verify that the monitor tarball includes both Windows binaries, install that tarball with normal npm install scripts enabled on a Windows machine without Python, MSVC, or Zig, and test real window behavior in an interactive desktop session. Hosted Windows CI verifies packaging and addon smoke tests, but its preinstalled build tools mean it does not prove a toolchain-free install or full Launchpad/PM2 integration. See the native addon README for the manual checks.

### Project Structure

Launchpad is organized as an npm workspaces monorepo:

```
packages/
├── cli/           # Command-line interface and configuration management
├── content/       # Content fetching and transformation pipeline
├── monitor/       # Process monitoring and management via PM2
├── utils/         # Shared utilities and base functionality
├── testing/       # Testing utilities and setup
└── launchpad/     # Meta-package that installs all core packages
```

## Project Architecture

### Core Concepts

**Launchpad** is a suite of tools for managing interactive installations. It provides:

- **Content Management**: Fetching and transforming data from CMSs/APIs into a SQLite-backed DataStore
- **Process Monitoring**: Managing long-running applications via PM2 with window management

### Monorepo Packages

#### @bluecadet/launchpad-cli
The main entry point that orchestrates the entire system. It:
- Loads and validates `launchpad.config.js` configuration
- Initializes the content and monitor subsystems
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

#### @bluecadet/launchpad-utils
Shared foundational utilities:
- Centralized logging via `LogManager` with hierarchical logger support
- Base `PluginDriver` for plugin lifecycle management
- Exit handling utilities for graceful shutdown
- Shared TypeScript configuration

### Configuration System

All config schemas use Zod for validation and are defined in:
- `packages/cli/src/launchpad-config.ts` - Top-level config schema
- `packages/controller/src/controller-config.ts` - Controller system schema
- `packages/content/src/content-config.ts` - Content system schema
- `packages/monitor/src/monitor-config.ts` - Monitor system schema

### Schema-backed configuration references

Configuration references in `docs/reference/` render directly from the runtime Zod schemas through `docs/components/ConfigReference.astro`. The registry in `docs/lib/config-references.ts` gives each reference a stable id. MDX pages import the component with `import ConfigReference from '@docs-src/components/ConfigReference.astro';`. Use the `@docs-src/` alias rather than a relative import: the docs wrapper copies pages to normalized route paths before rendering them. There are no checked-in generated property lists to update.

When a page has handwritten property headings, embed metadata under each heading with an exact path, such as `<ConfigReference id="content-options" property="sources" />`. The selected property renders only **Input type**, **Required**, and **Input default**, in a compact wrapping metadata row. It does not generate a property name, heading, anchor, or schema description: the MDX heading and authored prose own that explanation. Preserve the authored behavior notes, caveats, examples, and links; a concise schema description is not a replacement for them.

The `ConfigReference` contributor API is:

- `id`: a registry id (required).
- `property`: the exact extracted property path, such as `sources` or `apps[].pm2`. Use `(root)` to select a synthetic root row. Omit `property` on pages without individual property sections to render the complete vertical definition list, including schema descriptions.
- `includeChildren`: render the selected property's descendants as vertical definitions with names, metadata, and schema descriptions. Omit it when those fields have their own authored sections.
- `exclude`: exact descendant paths to delegate to another section, such as `exclude={["retry.backoff"]}` on the `retry` selection. Requires `property` and `includeChildren`; each exclusion removes that row and its subtree.

For small object shapes, put the parent metadata first, then an explanation and input example, then a compact schema-backed field table:

```mdx
import ConfigReference from '@docs-src/components/ConfigReference.astro';
import ConfigFieldTable from '@docs-src/components/ConfigFieldTable.astro';

### `versioning`

<ConfigReference id="content-options" property="versioning" />

Explain shorthand and object forms here, followed by an example.

<ConfigFieldTable id="content-options" property="versioning" caption="Object fields (relative to versioning)" />
```

`ConfigFieldTable` requires `id`, `property`, and a plain-text `caption`. It renders descendants only, never the parent metadata. Field names are local to the selected object; an array selection describes one item (`sources[].id` becomes `id`). Introduce array items as a named shape, such as `ContentSource`, and state the item context in prose or the caption. Types, requiredness, defaults, and descriptions still come directly from the schema. Keep the parent input default separate from object-field defaults; do not invent a resolved default object or copy field types/defaults into MDX tables.

Tables accept `exclude` with the same exact-subtree semantics as `ConfigReference`, without `includeChildren`. Only immediate fields of an object or one array-item shape are supported. Deeper paths, record entries, synthetic roots, and empty selections fail the build: delegate a nested object to its own section/table and exclude its subtree from the outer table. This prevents an evolving schema from silently becoming an ambiguous flattened table. Use authored child sections for behavior-heavy objects such as Monitor window and logging settings.

Do not use a merged field table to imply that mutually exclusive union fields can be combined. Document policies/branches explicitly, with valid input examples and conditional requiredness. Scheduler's `maxAttempts` is required only for `forever: false`, while `backoff` belongs only to the forever policy. The shared metadata reports structural requiredness across the input schema, not branch-specific requirements. Runtime fallbacks belong in descriptions or prose, not the **Input default** column.

Description rendering follows the mode automatically; there is no separate description-policy prop. Unknown ids, property paths, and invalid exclusions fail the docs build. Do not repeat a full reference before individual property sections. Each schema row must appear exactly once per reference id across parent metadata, authored child sections, and field tables; `docs/lib/__tests__/config-reference-coverage.test.ts` checks the authored MDX calls against the registry.

When changing a configuration field:

1. Change its runtime schema and add a concise `.describe()` for its meaning. Ordinary input types, optionality, and `.default()` / `.prefault()` values come from Zod, not a separate documentation model.
2. Use `.meta({ configDocs: { inputType, defaultLabel, propertiesFrom } })` only where needed: `inputType` labels opaque public types, `defaultLabel` describes contextual or nonserializable defaults, and `propertiesFrom: "output"` exposes downstream fields of a preprocess or pipe without replacing the accepted input type. Do not duplicate ordinary field types or defaults in metadata.
3. Keep transform/runtime defaults and conditional rules in schema descriptions or surrounding prose. The renderer documents structural requiredness; it does not infer arbitrary refinement rules.
4. Build the docs to verify the rendered reference. Update surrounding operational notes, examples, and property headings when the behavior changes.

Keep schema descriptions concise: summarize the field's meaning for generated descendant and fallback definitions. They are rendered as literal plain text, not interpreted as Markdown or HTML. Keep richer explanations, formatted notes, caveats, links, and examples in the MDX page around the component, including for selected properties whose schema descriptions are not rendered. Do not shorten or remove authored prose just because a schema description covers the same topic.

MDX pages need explicit `title` frontmatter and no leading H1, because the docs layout renders the title. Unlike Markdown pages, MDX pages do not receive source-relative link rewriting; use published routes such as `/reference/content/content-config/` instead of `./content-config.md`.

The references import built workspace packages, so their schema dependencies must be compiled with `tsc --build` before Astro starts. The docs workspace's `prebuild` and `predev` scripts handle this prerequisite.

From the repository root:

```bash
# Compile the schema dependencies, then build the documentation site
npm run docs:build

# Compile the schema dependencies, then start the documentation dev server
npm run dev -w @bluecadet/launchpad-docs
```

For schema-source edits during docs development, also run `npm run dev` from the repository root in a separate terminal. This TypeScript watcher rebuilds the workspace packages that the references import; the docs server alone does not compile schema source changes. This docs-only tooling does not require create-package scaffolding changes.

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
5. **Transform**: Run content transforms on fetched content
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
# Run the local maintainer checks (fail-fast, no watch mode)
npm run check

# Check workspace dependency consistency
npm run sherif

# Check unused dependencies and exports
npm run knip

# Build all packages
npm run build

# Watch mode for development
npm run dev

# Lint code with Biome
npm run lint

# Fix linting issues
npm run lint:fix

# Run all tests in watch mode
npm test

# Run tests for specific package
npm test -w @bluecadet/launchpad-content

# Run tests matching a pattern
npm test -- <file-pattern>
```

### Branch Strategy

- **main**: Primary development branch. All PRs should target this branch.
- **feature branches**: Create from `main` with descriptive names (e.g., `feat/controller-mode`, `fix/content-timing`)

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

### Expected logging diagnostics

Shared setup automatically captures only `console.warn` messages with the `[launchpad logging] ` prefix. Declare deliberate diagnostics before triggering them:

```ts
import { expectLoggingDiagnostic } from "@bluecadet/launchpad-testing/test-utils.ts";

expectLoggingDiagnostic("File-backed logging is unavailable: directory is locked");
// Trigger the intentional source failure here.
```

Pass the message without the prefix. Strings match exactly; regular expressions are supported for variable details. The optional second argument is the expected count (default: one). Verification runs after test cleanup and fails on missing, extra, or undeclared diagnostics. Unexpected diagnostics are also forwarded to the original console. Other warnings and all errors remain unchanged. Event-bus diagnostics are not intercepted; keep assertions on their payloads where relevant.

Each test gets a console copy, restored at test finish even if logger console overriding freezes it. Do not replace `console.warn` with a silent mock for deliberate Launchpad diagnostics. Await owned asynchronous work and cleanup before the test finishes: callbacks that outlive the test are forwarded rather than silently captured. This console fixture is for sequential tests, not `test.concurrent`.

## Code Quality

### Local Maintainer Checks

```bash
npm run check
```

Runs Biome lint/format checks, Sherif, Knip, the docs build, root typecheck, and tests in that order. Stops at the first failure; tests run once without watch mode. It does not autofix formatting; use `npm run lint:fix` separately.

The docs build runs before the root typecheck to approximate CI's independent docs build. The typecheck uses `tsc --build` for production and test projects and emits build artifacts needed by tests; this is not a read-only check.

This command does not reproduce clean-checkout or multi-OS CI, the pinned-Zig native binary drift check, or package-content assertions. CI retains its independent jobs and platform matrix.

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

### Workspace Consistency

```bash
npm run sherif
```

Sherif checks workspace package and dependency consistency. Like CI, it ignores `@bluecadet/launchpad*` dependency version mismatches because Changesets manages those versions. Knip separately checks for unused dependencies and exports.

### Unused Dependencies and Exports

Run the same Knip check used in CI:

```bash
npm run knip
```

The content workspace has a narrow `ignoreDependencies` exception for
`@types/http-cache-semantics`. `http-cache-semantics@4.2.0` advertises
`"types": "index.js"` but ships no TypeScript declarations. Knip treats that
metadata as bundled types and incorrectly reports the separate typings as unused;
TypeScript resolves the adapter's policy types through `@types/http-cache-semantics`.
Keep this dependency and remove the exception when upstream metadata or Knip's
bundled-type detection is corrected.

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
cd ../utils
npm link
cd ../controller
npm link
cd ../create
npm link
cd ../launchpad
npm link

# In your test project
npm link @bluecadet/launchpad-cli @bluecadet/launchpad-content @bluecadet/launchpad-monitor @bluecadet/launchpad-utils @bluecadet/launchpad @bluecadet/launchpad-controller @bluecadet/create-launchpad
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
import { content } from '@bluecadet/launchpad-content';
import { monitor } from '@bluecadet/launchpad-monitor';

export default defineConfig({
  plugins: [
    content({
      sources: [],      // Add your content sources
      transforms: [],   // Add your transforms
    }),
    monitor({
      apps: [],         // Add your apps to monitor
    }),
  ]
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
npm unlink @bluecadet/launchpad-cli @bluecadet/launchpad-content @bluecadet/launchpad-monitor @bluecadet/launchpad-utils @bluecadet/launchpad @bluecadet/launchpad-controller @bluecadet/create-launchpad
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

Changelogs are for users upgrading, not a log of commits. Explain what changed, who it affects, and any action they need to take. Include user-facing fixes, features, and breaking changes; skip internal refactors, test-only changes, and documentation-only updates.

Use Markdown with a plain-text summary on the first line, not a heading. For example:

- "Fix content pipeline crash when source timeout occurs"
- "Add `maxRetries` config option to content sources"

Avoid implementation-only summaries such as "Fix typo in variable name."

#### Ordinary changesets (the default)

Use an ordinary changeset for all packages, including the umbrella `@bluecadet/launchpad` alone or alongside subpackages. Keep the entry compact: a concise summary, with a short explanation or upgrade note when needed.

The body is shared by every package listed in the frontmatter. Group affected packages when the same explanation applies; use separate changesets when their explanations differ. Choose package membership and bump types based on actual public API impact, including umbrella re-exports, not simply because one package depends on another. See the [versioning policy](#versioning-policy) below.

Multiple changesets for one package produce one version bump per release, with the highest requested bump winning. You don't need to combine unrelated explanations to avoid multiple bumps.

Ordinary entries get an unobtrusive PR-link suffix when an associated PR is found. Generated commit hashes and contributor prefixes are omitted. Author-written links remain intact.

#### Release overviews (rare, explicit opt-in)

Use an overview for a substantial major or breaking release that needs a cross-package narrative: how the changes fit together, what upgrading requires, and important limitations. Neither targeting the umbrella nor writing a long body makes a changeset an overview automatically.

Opt in with the exact marker `<!-- changeset: overview -->` immediately after the plain-text summary and a blank line, followed by another blank line:

```md
---
'@bluecadet/launchpad': major
---

Reuse content work and replay retained logs

<!-- changeset: overview -->

Content runs can reuse downloads and generated files. Log destinations can resume
retained delivery after a restart. Upgrading requires configuration changes.

#### Before upgrading

- Check the supported Node.js versions.
- Update downloader and logging configuration.

#### Limitations

Retained log delivery isn't lossless or exactly once.
```

The formatter removes the marker and renders a bold summary followed by normal paragraphs, headings, lists, and code blocks, rather than one large bullet. Overviews don't get automatic PR or commit references; links you write yourself are preserved. For extensive upgrade instructions, link to a migration guide.

Use H4–H6 (`####` through `######`) for overview sections. Changesets already generates the `##` version heading and `### Major/Minor/Patch Changes` headings. The GitHub release extractor stops at the next H2, which can truncate the current release. The formatter rejects H1–H3 outside backtick code fences both to prevent truncation and to preserve the hierarchy below the generated H3 bump heading. Use backtick fences for code containing those headings; tilde fences don't protect them from the current extractor.

A long overview usually belongs only in the umbrella changelog, keeping subpackage entries focused. Keep shared subpackage changesets compact. Remove the umbrella from those entries only when its overview already covers the changes, so the umbrella doesn't repeat the same summaries. An overview may deliberately target multiple packages if the full narrative is useful to each audience.

Package membership controls changelog scope and version bumps; the marker controls presentation only. There's no need to split an overview solely for formatting. It still appears under Changesets' bump heading: the supported formatter callbacks can't remove that wrapper.

#### Formatter maintenance

The local formatter is `.changeset/changelog.cjs`. This policy applies to newly generated entries; it doesn't rewrite historical changelogs. Test formatter changes from the repository root:

```bash
npx vitest run --project changesets
```

Local versioning (`npm run changeset -- version`) still needs `GITHUB_TOKEN` for automatic PR lookup on committed ordinary changesets, using the same GitHub helper as the previous formatter. Overviews and dependency-update lines don't query GitHub. No compare link is generated because the formatter doesn't receive the package's old and new versions; add a known full-changelog link manually when useful.

### Non-Packages

Don't create changesets for:
- Examples and demo projects
- Test utilities and test files
- Documentation updates
- Development tooling changes

## Releases

### Versioning policy

All packages, including the umbrella, follow SemVer and are versioned independently. Breaking public API changes require a major release of the affected package. The umbrella's public API includes its re-exports, so breaking those APIs requires an umbrella major too. A dependency major alone does not automatically require an umbrella major if the umbrella's public contract remains compatible. Choose changeset types based on each package's public contract, not automatic dependency bumps or matching major numbers.

See [Versioning and upgrades](./docs/guides/packages.md#versioning-and-upgrades) for the consumer policy and upcoming release versions.

### Release Process

1. **Create changeset**: Include with your PR when adding user-facing changes
2. **Open PR**: Open a PR against `main`
3. **Merge PR**: Once approved, merge the PR into `main`
4. **Wait for Version PR**: The [Changesets GitHub action](https://github.com/changesets/action#usage) automatically creates a "Version Packages" PR
5. **Review and merge**: Review the version bumps and changelog, then merge the PR
6. **Automatic publish**: npm packages are automatically published to the npm registry

#### Release automation contract

The workflow pairs Changesets action v2 with Changesets CLI v3. The action supplies a `CHANGESETS_OUTPUT` file path; the CLI appends structured NDJSON events that the action uses to push tags and create GitHub releases. Action v1 parsed human-readable `New tag:` output instead, which CLI v3 no longer emits. Keep the action and CLI compatible when upgrading either.

The action's `publish-script` input runs `npm run release`, which must pass the inherited `CHANGESETS_OUTPUT` environment variable through to the CLI unchanged. Keep the build and publish stages joined with `&&` and propagate failures; don't swallow a nonzero exit status or replace the structured output with stdout parsing. `push-with-git-cli: true` preserves Git-based pushing, and non-cancelling concurrency serializes release runs for the same workflow and ref.

Run the offline release-tooling tests with `npx vitest run --project changesets`. They check the workflow contract and exercise CLI `git-tag` in temporary repositories with local remotes, without publishing packages or writing to GitHub.

#### If npm succeeds but GitHub tags or releases are missing

Treat this as **GitHub-only recovery**, not another npm publish. Verify the published package versions and their npm `gitHead` metadata against the original release commit. For each missing package tag, use that verified commit and the package's exact `name@version` tag; create the missing GitHub release with the exact corresponding version section from that package's `CHANGELOG.md` at the same commit. Don't substitute the latest `main` or summarize the changelog notes.

Check existing tags and releases before creating anything. Never republish an already-published npm version or force-move an existing tag. If a tag points elsewhere, or published packages disagree about the release commit, stop and investigate rather than overwriting it. Fixing the workflow protects future releases; it does not repair a previous run's missing GitHub artifacts automatically.

### Branch Management

- **main**: Primary development branch. All PRs target this branch.

## Best Practices

### General Principles

1. **Explicit over implicit**: Write clear, self-documenting code
2. **Fail fast**: Validate inputs early and return errors explicitly
3. **Type safety**: Leverage TypeScript's type system to prevent bugs
4. **Composition over inheritance**: Use plugin architecture and utility functions
5. **Logging**: Add context-aware logging for debugging and monitoring

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
      logger.verbose('Operation aborted');
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
