# Contributing to Launchpad

## Getting started

### Setup

Repository development, including the Changesets release tooling, requires Node.js 24 or 26 and later (`^24 || >=26`). This requirement does not change the supported runtime baseline of published packages.

```bash
# Clone the repository
git clone git@github.com:bluecadet/launchpad.git
cd launchpad

# Install dependencies for all packages
npm install
```

The monitor's Windows window-management addon is checked in as precompiled x64 and arm64 binaries, so installing dependencies or building TypeScript needs no Python, MSVC, or Zig. An earlier arm64 prebuild passed a manual Windows arm64 smoke check before the switch to generated Node import libraries; the current prebuilds still need Windows runtime validation.

### Rebuilding and verifying the Windows addon

Only maintainers changing the native addon need the pinned Zig toolchain. Rebuild native binaries manually; `npm install` never rebuilds them. The [native addon README](./packages/monitor/native/README.md) lists the build command, toolchain version, and Windows verification procedure. Commit the source changes together with the rebuilt prebuilds.

The **Native binary drift** CI job rebuilds when changes touch `packages/monitor/native/**`, `packages/monitor/prebuilds/**`, or `.github/workflows/ci.yml`, and skips otherwise. Manual workflow dispatches and change-detection failures always rebuild. Lint, CI, and native packaging checks run regardless of the native path filter.

Run the Windows-only smoke tests against the real bundled addon from the repository root:

```sh
npx vitest run packages/monitor/src/utils/__tests__/windows-native.windows.test.ts
```

The tests drive a disposable PowerShell/.NET Windows Forms window, with no addon mocks or added consumer dependencies. They require Windows x64 or arm64 with a matching Node architecture, built-in Windows PowerShell 5.1, and policies that allow .NET Windows Forms and `Add-Type`. They need no Python, MSVC, or Zig. The suite checks enumeration, the exact title, minimize and hide (each observed independently through Win32 state), live mismatched-PID no-ops, and stale descriptors after fixture termination. Non-Windows platforms skip the suite; on supported Windows, addon-load or fixture failures fail the run.

The `windows-latest` CI job discovers the tests through Vitest and covers x64 only; arm64 needs a separate Windows arm64 run. Windows focus restrictions make foreground activation a manual, best-effort check.

Before release, verify that the monitor tarball includes both Windows binaries. Install that tarball, with normal npm install scripts enabled, on a Windows machine without Python, MSVC, or Zig, and test real window behavior in an interactive desktop session. Hosted Windows CI verifies packaging and runs the addon smoke tests, but its preinstalled build tools mean it cannot prove a toolchain-free install or full Launchpad/PM2 integration. The native addon README lists the manual checks.

### Project structure

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

## Project architecture

### Core concepts

Launchpad is a suite of tools for managing interactive installations. It handles:

- Content management: fetching data from CMSs and APIs, transforming it, and storing it in a filesystem-backed DataStore
- Process monitoring: running long-lived applications under PM2, with window management

### Monorepo packages

#### @bluecadet/launchpad-cli

The main entry point, which orchestrates the system. It:

- Loads and validates `launchpad.config.js` configuration
- Initializes the content and monitor subsystems
- Provides the user-facing CLI commands

#### @bluecadet/launchpad-content

Fetches and transforms content:

- Manages content sources (Airtable, Contentful, Sanity, Strapi, JSON)
- Runs a content pipeline: setup -> backup -> clear -> fetch -> transform -> restore/cleanup
- Stores downloaded content in a filesystem-backed DataStore
- Extends content transformation through plugins

#### @bluecadet/launchpad-monitor

Manages application processes and their lifecycle:

- Manages processes with PM2
- Captures and routes application stdout/stderr
- Manages window state and z-order on Windows through platform-specific APIs
- Lets plugins react to app lifecycle events

#### @bluecadet/launchpad-utils

Shared utilities:

- Centralized logging through `LogManager`, with hierarchical loggers
- Base `PluginDriver` for plugin lifecycle management
- Exit handling for graceful shutdown
- Shared TypeScript configuration

### Configuration system

Config schemas use Zod for validation and live in:
- `packages/cli/src/launchpad-config.ts` - Top-level config schema
- `packages/controller/src/controller-config.ts` - Controller system schema
- `packages/content/src/content-config.ts` - Content system schema
- `packages/monitor/src/monitor-config.ts` - Monitor system schema

#### Public config input types

Public config input types are hand-written, JSDoc'd interfaces bound to the schema with `configSchema<T>()(schema)` from `@bluecadet/launchpad-utils/config-schema`. Do not export `z.input<...>` types or accept `z.input` parameters in exported functions; Biome flags both. Zod wraps object shapes in `{...} & {}`, and `tsc` only copies comments for declarations in the file it emits, so `z.input` loses property docs in `.d.ts` hovers.

- Put property docs on the interface, not on the schema body.
- `.loose()` schemas need `[key: string]: unknown;` in the interface.
- Use `z.unknown()` or `z.custom<T>()` instead of `z.any()`; `any` never matches exactly.
- A schema with an `unknown` input (`z.preprocess`) cannot be bound. Bind the inner object schemas instead.
- Type factory params with the interface.

Typechecking fails unless the schema input exactly equals the interface. See `packages/content/src/transforms/symlink.ts`.

### Schema-backed configuration references

Configuration references in `docs/reference/` render directly from the runtime Zod schemas through `docs/components/ConfigReference.astro`. The registry in `docs/lib/config-references.ts` gives each reference a stable id. MDX pages import the component with `import ConfigReference from '@docs-src/components/ConfigReference.astro';`. Use the `@docs-src/` alias instead of a relative import, because the docs wrapper copies pages to normalized route paths before rendering them. No generated property lists are checked in.

When a page has handwritten property headings, embed metadata under each heading with an exact path, such as `<ConfigReference id="content-options" property="sources" />`. The selected property renders only **Input type**, **Required**, and **Input default**, in a compact wrapping row. It generates no property name, heading, anchor, or schema description; the MDX heading and authored prose provide those. Keep authored behavior notes, caveats, examples, and links, since a concise schema description cannot replace them.

The `ConfigReference` contributor API is:

- `id`: a registry id (required).
- `property`: the exact extracted property path, such as `sources` or `apps[].pm2`. Use `(root)` to select a synthetic root row. Omit `property` on pages without individual property sections to render the complete vertical definition list, including schema descriptions.
- `includeChildren`: render the selected property's descendants as vertical definitions with names, metadata, and schema descriptions. Omit it when those fields have their own authored sections.
- `exclude`: exact descendant paths to delegate to another section, such as `exclude={["retry.backoff"]}` on the `retry` selection. Requires `property` and `includeChildren`; each exclusion removes that row and its subtree.

For small object shapes, put the parent metadata first, then an explanation and input example, then a schema-backed field table:

```mdx
import ConfigReference from '@docs-src/components/ConfigReference.astro';
import ConfigFieldTable from '@docs-src/components/ConfigFieldTable.astro';

### `versioning`

<ConfigReference id="content-options" property="versioning" />

Explain shorthand and object forms here, followed by an example.

<ConfigFieldTable id="content-options" property="versioning" caption="Object fields (relative to versioning)" />
```

`ConfigFieldTable` requires `id`, `property`, and a plain-text `caption`. It renders descendants only, never the parent metadata. Field names are local to the selected object, and an array selection describes one item (`sources[].id` becomes `id`). Introduce array items as a named shape, such as `ContentSource`, and state the item context in prose or the caption. Types, requiredness, defaults, and descriptions come directly from the schema. Keep the parent input default separate from object-field defaults; do not invent a resolved default object or copy field types or defaults into MDX tables.

Tables accept `exclude` with the same exact-subtree semantics as `ConfigReference`, without `includeChildren`. They support only the immediate fields of an object or of one array-item shape. Deeper paths, record entries, synthetic roots, and empty selections fail the build, so an evolving schema cannot silently flatten into an ambiguous table. Give a nested object its own section or table and exclude its subtree from the outer table. Use authored child sections for behavior-heavy objects such as Monitor window and logging settings.

Do not merge mutually exclusive union fields into one table, which implies they can be combined. Document each policy or branch explicitly, with valid input examples and conditional requiredness. For example, Scheduler's `maxAttempts` is required only for `forever: false`, and `backoff` belongs only to the forever policy. The shared metadata reports structural requiredness across the input schema, not branch-specific requirements. Put runtime fallbacks in descriptions or prose, not the **Input default** column.

The rendering mode determines whether descriptions appear; no prop controls it. Unknown ids, property paths, and invalid exclusions fail the docs build. Do not repeat a full reference before individual property sections. Each schema row must appear exactly once per reference id across parent metadata, authored child sections, and field tables; `docs/lib/__tests__/config-reference-coverage.test.ts` checks the authored MDX calls against the registry.

When changing a configuration field:

1. Change its runtime schema and add a concise `.describe()` for its meaning. Ordinary input types, optionality, and `.default()` / `.prefault()` values come from Zod, not a separate documentation model.
2. Use `.meta({ configDocs: { inputType, defaultLabel, propertiesFrom } })` only where needed: `inputType` labels opaque public types, `defaultLabel` describes contextual or nonserializable defaults, and `propertiesFrom: "output"` exposes downstream fields of a preprocess or pipe without replacing the accepted input type. Do not duplicate ordinary field types or defaults in metadata.
3. Keep transform/runtime defaults and conditional rules in schema descriptions or surrounding prose. The renderer documents structural requiredness; it does not infer arbitrary refinement rules.
4. Build the docs to verify the rendered reference. Update surrounding operational notes, examples, and property headings when the behavior changes.

Keep schema descriptions concise: summarize the field's meaning for generated descendant and fallback definitions. They render as literal plain text, not Markdown or HTML. Put richer explanations, formatted notes, caveats, links, and examples in the MDX around the component, including for selected properties whose schema descriptions do not render. Do not cut authored prose because a schema description covers the same topic.

MDX pages need explicit `title` frontmatter and no leading H1, because the docs layout renders the title. MDX pages, unlike Markdown pages, get no source-relative link rewriting; use published routes such as `/reference/content/content-config/` instead of `./content-config.md`.

The references import built workspace packages, so `tsc --build` must compile their schema dependencies before Astro starts. The docs workspace's `prebuild` and `predev` scripts handle this.

From the repository root:

```bash
# Compile the schema dependencies, then build the documentation site
npm run docs:build

# Compile the schema dependencies, then start the documentation dev server
npm run dev -w @bluecadet/launchpad-docs
```

When editing schema source during docs development, also run `npm run dev` from the repository root in a separate terminal. This TypeScript watcher rebuilds the workspace packages the references import; the docs server does not compile schema source changes. This docs-only tooling requires no create-package scaffolding changes.

### Plugin system

The content and monitor subsystems share a plugin architecture.

The base plugin driver (`packages/utils/src/plugin-driver.ts`):

- Runs typed hook functions that plugins implement for specific lifecycle points
- Runs hooks sequentially or in parallel
- Gives each plugin a context with a logger, abort signal, and working directory

Content plugins (`packages/content/src/content-plugin-driver.ts`) run after content fetch to transform or post-process downloaded content.

Monitor plugins (`packages/monitor/src/core/monitor-plugin-driver.ts`) react to app lifecycle events for monitoring, logging, notifications, and custom app management.

### Content pipeline flow

A content fetch runs these steps:

1. Setup: load sources from config and initialize plugins.
2. Backup (optional): back up existing downloads.
3. Clear: remove old downloads, respecting the config's `keep` patterns.
4. Fetch: run all source fetch functions in parallel.
   - Sources return documents shaped `{ id, data }`.
   - Data can be a Promise or AsyncIterable.
   - The DataStore stores documents namespaced by source ID.
5. Transform: run content transforms on the fetched content.
6. Restore: on failure, restore from backup if enabled.
7. Cleanup: remove temporary and backup directories.

Content sources (`packages/content/src/sources/`) implement the `ContentSource` interface with `id` and `fetch(context)`. They receive a `FetchContext` holding a logger, the DataStore instance, and an AbortSignal.

The DataStore (`packages/content/src/utils/data-store.ts`) stores downloaded content on the filesystem, organized by source ID (namespace) and document ID. It serializes JSON and writes files.

### Process monitoring architecture

The monitor manages applications through PM2 in layers:

- `ProcessManager` (`core/process-manager.ts`): low-level PM2 interface (connect, start, stop, list, get logs)
- `BusManager` (`core/bus-manager.ts`): captures app stdout/stderr and routes it to Launchpad logs
- `AppManager` (`core/app-manager.ts`): high-level app lifecycle (start, stop, validate) and window management

Each app is configured with:

- A `pm2` config object, following PM2 StartOptions
- An optional `windows` config for foreground, minimize, and hide behavior
- An optional `logging` config for stdout/stderr routing

## Development guidelines

### Common commands

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

### Branch strategy

- `main` is the primary development branch. Target all PRs at it.
- Create feature branches from `main` with descriptive names, such as `feat/controller-mode` or `fix/content-timing`.

### Code style

Biome lints and formats the code. Before committing, run:

```bash
npm run lint:fix
```

Style guidelines:

- Write all new code in TypeScript.
- Follow the package's existing patterns.
- Add JSDoc comments to public APIs.
- Use meaningful variable and function names.
- Keep functions focused and testable.

### File organization

- Source code: `src/`
- Tests: `__tests__/` (colocated with source)
- Test utilities: `__tests__/test-utils.ts`
- Built output: `dist/`
- Configuration: `tsconfig.src.json`, `package.json`

## Error handling with neverthrow

The codebase uses [neverthrow](https://github.com/supermacro/neverthrow) for functional error handling. Never throw errors in production code; return a `Result` type.

With neverthrow:

- Errors are part of the function signature, so the compiler surfaces error cases.
- Async operations return `ResultAsync`, which prevents silent failures from unhandled promises.
- `.andThen()`, `.map()`, and `.orElse()` compose error chains without nested try-catch.
- TypeScript enforces handling every error case.
- Functions with predictable, typed results are easier to test.

## Testing

### Philosophy

- Colocate tests with source code in `__tests__` directories.
- Cover business logic and error cases thoroughly.
- Mock external dependencies such as APIs, the file system, and PM2.
- Use realistic test data and scenarios.

### Setup and utilities

Tests use Vitest. Custom setup lives in `packages/testing/src/setup.ts` and utilities in `packages/testing/src/test-utils.ts`.

Content plugin tests have specialized utilities in `packages/content/src/plugins/__tests__/plugins.test-utils.ts`.

### Expected logging diagnostics

Shared setup captures only `console.warn` messages with the `[launchpad logging] ` prefix. Declare deliberate diagnostics before triggering them:

```ts
import { expectLoggingDiagnostic } from "@bluecadet/launchpad-testing/test-utils.ts";

expectLoggingDiagnostic("File-backed logging is unavailable: directory is locked");
// Trigger the intentional source failure here.
```

Pass the message without the prefix. Strings match exactly; use a regular expression for variable details. The optional second argument sets the expected count (default: one). Verification runs after test cleanup and fails on missing, extra, or undeclared diagnostics, and unexpected diagnostics also go to the original console. Other warnings and all errors pass through unchanged. Setup does not intercept event-bus diagnostics; assert on their payloads where relevant.

Each test gets a console copy, restored when the test finishes even if logger console overriding freezes it. Do not replace `console.warn` with a silent mock for deliberate Launchpad diagnostics. Await owned asynchronous work and cleanup before the test finishes, because setup forwards callbacks that outlive the test instead of capturing them. The console fixture supports sequential tests, not `test.concurrent`.

## Code quality

### Local maintainer checks

```bash
npm run check
```

This runs Biome lint and format checks, Sherif, Knip, the docs build, the root typecheck, and tests, in that order, and stops at the first failure. Tests run once without watch mode. It does not autofix formatting; run `npm run lint:fix` for that.

The docs build runs before the root typecheck to approximate CI's independent docs build. The typecheck runs `tsc --build` for production and test projects and emits build artifacts the tests need, so it writes files.

The command does not reproduce clean-checkout or multi-OS CI, the pinned-Zig native binary drift check, or package-content assertions. CI keeps its independent jobs and platform matrix.

### TypeScript

- Use strict mode (on by default in `tsconfig.src.json`).
- Annotate function parameters and return types.

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

### Workspace consistency

```bash
npm run sherif
```

Sherif checks workspace package and dependency consistency. Like CI, it ignores `@bluecadet/launchpad*` dependency version mismatches, because Changesets manages those versions.

### Unused dependencies and exports

Run the same Knip check used in CI:

```bash
npm run knip
```

The content workspace has a narrow `ignoreDependencies` exception for
`@types/http-cache-semantics`. `http-cache-semantics@4.2.0` advertises
`"types": "index.js"` but ships no TypeScript declarations. Knip reads that
metadata as bundled types and wrongly reports the separate typings as unused;
TypeScript resolves the adapter's policy types through `@types/http-cache-semantics`.
Keep the dependency, and remove the exception once upstream metadata or Knip's
bundled-type detection is fixed.

### Building

```bash
# Build all packages
npm run build
```

## Testing the CLI with npm link

To test local Launchpad changes as a dependency of another project without publishing to npm, link the packages.

### Setup

#### 1. Build Launchpad packages

From the launchpad repository root:

```bash
npm run build
```

#### 2. Link packages

Link each Launchpad package. Linking symlinks the local package into your project's `node_modules`.

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

### Development workflow

Once the packages are linked, run watch mode to rebuild on change:

```bash
# In launchpad repo
npm run dev
```

Watch mode compiles TypeScript source changes, and your test project picks them up.

### Testing with a real config

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

When you finish testing, unlink the packages:

```bash
# In your test project
npm unlink @bluecadet/launchpad-cli @bluecadet/launchpad-content @bluecadet/launchpad-monitor @bluecadet/launchpad-utils @bluecadet/launchpad @bluecadet/launchpad-controller @bluecadet/create-launchpad
```

### Troubleshooting

If the test project doesn't pick up changes:

- Make sure `npm run build` or `npm run dev` ran in the Launchpad repo.
- Run `npm link` again in the package directory to repair the link.
- Clear the test project's cache: `rm -rf node_modules/.cache`

If the test project shows TypeScript errors:

- Make sure the test project has TypeScript and can see the Launchpad types.
- Run `npm install` in both the Launchpad repo and the test project to sync types.

If module resolution fails:

- Verify the package names.
- Remove and re-create the links.

## Creating changesets

Create a changeset for every user-facing change:

```bash
npm run changeset
```

The prompts ask you to:

1. Select the affected packages.
2. Choose a change type: major, minor, or patch.
3. Describe the change.

### Changeset guidelines

Write changelogs for users who are upgrading. Explain what changed, who it affects, and any action they need to take. Include user-facing fixes, features, and breaking changes; skip internal refactors, test-only changes, and documentation-only updates.

Use Markdown with a plain-text summary on the first line, not a heading. For example:

- "Fix content pipeline crash when source timeout occurs"
- "Add `maxRetries` config option to content sources"

Avoid implementation-only summaries such as "Fix typo in variable name."

#### Ordinary changesets (the default)

Use an ordinary changeset for every package, including the umbrella `@bluecadet/launchpad` alone or with subpackages. Keep the entry compact: a concise summary, plus a short explanation or upgrade note when needed.

Every package listed in the frontmatter shares the body. Group packages that share an explanation; use separate changesets when explanations differ. Choose packages and bump types by actual public API impact, including umbrella re-exports, rather than by dependency relationships. See the [versioning policy](#versioning-policy) below.

Multiple changesets for one package produce one version bump per release, and the highest requested bump wins, so keep unrelated explanations in separate changesets.

Ordinary entries get a PR-link suffix when the formatter finds an associated PR. Generated commit hashes and contributor prefixes are omitted. Links you write stay intact.

#### Release overviews (rare, explicit opt-in)

Use an overview for a substantial major or breaking release that needs a cross-package narrative: how the changes fit together, what upgrading requires, and important limitations. Only the marker below makes a changeset an overview; targeting the umbrella or writing a long body does not.

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

The formatter removes the marker and renders a bold summary followed by normal paragraphs, headings, lists, and code blocks instead of one large bullet. Overviews get no automatic PR or commit references; links you write stay intact. For extensive upgrade instructions, link to a migration guide.

Use H4-H6 (`####` through `######`) for overview sections. Changesets already generates the `##` version heading and the `### Major/Minor/Patch Changes` headings. The GitHub release extractor stops at the next H2, which can truncate the current release. The formatter rejects H1-H3 outside backtick code fences to prevent truncation and to keep the hierarchy below the generated H3 bump heading. Put code that contains those headings in backtick fences; tilde fences don't protect them from the current extractor.

A long overview usually belongs only in the umbrella changelog, so subpackage entries stay focused and compact. Remove the umbrella from shared subpackage changesets only when its overview already covers those changes, so the umbrella changelog doesn't repeat them. An overview may target multiple packages when each audience needs the full narrative.

Package membership controls changelog scope and version bumps; the marker controls only presentation, so don't split an overview for formatting. The overview still appears under Changesets' bump heading, because the supported formatter callbacks can't remove that wrapper.

#### Formatter maintenance

The local formatter is `.changeset/changelog.cjs`. It applies to newly generated entries and doesn't rewrite historical changelogs. Test formatter changes from the repository root:

```bash
npx vitest run --project changesets
```

Local versioning (`npm run changeset -- version`) needs `GITHUB_TOKEN` to look up PRs for committed ordinary changesets, through the same GitHub helper as the previous formatter. Overviews and dependency-update lines don't query GitHub. The formatter never receives the package's old and new versions, so it generates no compare link; add a full-changelog link manually when useful.

### Non-packages

Don't create changesets for:

- Examples and demo projects
- Test utilities and test files
- Documentation updates
- Development tooling changes

## Releases

### Versioning policy

Every package, including the umbrella, follows SemVer and is versioned independently. A breaking public API change requires a major release of the affected package. The umbrella's public API includes its re-exports, so breaking those also requires an umbrella major. A dependency major alone requires no umbrella major while the umbrella's public contract stays compatible. Choose changeset types by each package's public contract, not by automatic dependency bumps or matching major numbers.

See [Versioning and upgrades](./docs/guides/packages.md#versioning-and-upgrades) for the consumer policy and upcoming release versions.

### Release process

1. Include a changeset in any PR with user-facing changes.
2. Open the PR against `main`.
3. Merge the approved PR into `main`.
4. The [Changesets GitHub action](https://github.com/changesets/action#usage) opens a "Version Packages" PR.
5. Review the version bumps and changelog, then merge that PR.
6. The packages publish to the npm registry automatically.

#### Release automation contract

The workflow pairs Changesets action v2 with Changesets CLI v3. The action supplies a `CHANGESETS_OUTPUT` file path, and the CLI appends structured NDJSON events that the action uses to push tags and create GitHub releases. Action v1 parsed human-readable `New tag:` output, which CLI v3 no longer emits. Keep the action and CLI compatible when upgrading either.

The action's `publish-script` input runs `npm run release`, which must pass the inherited `CHANGESETS_OUTPUT` environment variable to the CLI unchanged. Keep the build and publish stages joined with `&&` and propagate failures; don't swallow a nonzero exit status or replace the structured output with stdout parsing. `push-with-git-cli: true` preserves Git-based pushing, and non-cancelling concurrency serializes release runs for the same workflow and ref.

Run the offline release-tooling tests with `npx vitest run --project changesets`. They check the workflow contract and exercise CLI `git-tag` in temporary repositories with local remotes, without publishing packages or writing to GitHub.

#### If npm succeeds but GitHub tags or releases are missing

Recover on GitHub only; do not publish to npm again. Verify the published package versions and their npm `gitHead` metadata against the original release commit. For each missing package tag, use that verified commit and the package's exact `name@version` tag. Create each missing GitHub release from the matching version section of that package's `CHANGELOG.md` at the same commit. Don't substitute the latest `main` or summarize the changelog notes.

Check existing tags and releases before creating anything. Never republish a published npm version or force-move an existing tag. If a tag points elsewhere, or published packages disagree about the release commit, stop and investigate instead of overwriting. Fixing the workflow protects future releases but does not repair a previous run's missing GitHub artifacts.

## Best practices

### General principles

- Prefer explicit code that documents itself.
- Fail fast: validate inputs early and return errors explicitly.
- Use TypeScript's type system to prevent bugs.
- Favor composition over inheritance through plugins and utility functions.
- Add context-aware logging for debugging and monitoring.

### Abort signals

Every long-running operation receives an `AbortSignal`. Check and respect it:

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

### Testing private functions

To test internal helpers, prefer one of these approaches:

1. Test them through public APIs.
2. Export them for testing only, under a clear naming convention.
3. Keep them small enough that callers' tests cover them.

### Documentation

- Add JSDoc comments to all exported functions and types.
- Include usage examples in complex modules.
- Document plugin hooks and their lifecycle.
- Keep each package's README current.
- Document user API changes on the docs site (`docs/`).

## Getting help

- Check existing tests for examples.
- Look at similar modules for patterns.
- Ask in PRs or open a discussion.
