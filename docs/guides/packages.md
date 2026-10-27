# Packages and modularity

Launchpad ships as a set of npm packages under the `@bluecadet` scope. This page covers how they fit together and which to install.

## The umbrella package

Start with `@bluecadet/launchpad`. It re-exports every first-party plugin through scoped subpaths:

```
@bluecadet/launchpad/cli                          → defineConfig, config loading
@bluecadet/launchpad/content                      → content syncing plugin and types
@bluecadet/launchpad/monitor                      → process monitoring plugin and types
@bluecadet/launchpad/observability                → log aggregation plugin and types
@bluecadet/launchpad/observability/transports/loki → Loki transport
@bluecadet/launchpad/controller                   → IPC and process orchestration
```

Deeper subpaths give granular access:

```
@bluecadet/launchpad/content/sources          → all source adapters
@bluecadet/launchpad/content/sources/airtable → Airtable source only
@bluecadet/launchpad/content/transforms       → all transform plugins
@bluecadet/launchpad/content/transforms/sharp → Sharp image transform only
```

## Underlying packages

The umbrella wraps standalone packages: `@bluecadet/launchpad-cli`, `@bluecadet/launchpad-content`, `@bluecadet/launchpad-monitor`, and so on. They stay separate for these reasons:

- Content syncing and process monitoring are independent features, and many installations use only one. A project that needs only `monitor` skips the content pipeline entirely.
- Integrations with third-party services (Sanity, Airtable, Contentful, sharp) bring in large dependencies. The individual packages declare them as `peerDependencies`, so you install them only when you use them. The project generator adds the right ones.
- First-party and third-party plugins are both plain npm packages. Publishing the built-in plugins as standalone packages keeps them on the same footing as community plugins.

## Individual packages vs. the umbrella

Both work the same:

```typescript
// Umbrella (recommended)
import { content } from '@bluecadet/launchpad/content';

// Individual package (identical at runtime)
import { content } from '@bluecadet/launchpad-content';
```

The umbrella is a thin re-export layer. Its package dependencies determine which implementation versions it exposes.

Use the umbrella when you want a single install and don't need to control which packages are installed.

Use individual packages when you're building a custom plugin, writing library code that depends on one Launchpad feature, or managing versions independently.

## Versioning and upgrades

All packages, including `@bluecadet/launchpad`, follow Semantic Versioning: a breaking public API change requires a major release of the affected package. Packages are versioned independently. Their major numbers need not align, and matching major numbers do not guarantee compatibility.

The umbrella's public API includes the APIs it re-exports, so breaking those requires an umbrella major. So do breaking changes to its import paths, module layout, package composition, integration contracts, or supported runtime baseline. A dependency's major release alone does not require an umbrella major if the umbrella's public contract stays compatible.

The runtime packages and scaffolder support Node.js 24.x or 26 and later (`^24 || >=26`).

Before upgrading, read the changelogs and migration notes for the packages you use, including the [observability migration notes](../reference/observability/migration.md) and their controller logging changes. Commit your lockfile and review dependency updates before deployment. To prevent automatic version updates, pin an exact umbrella version and commit the lockfile so the resolved implementation dependencies stay fixed.

## Peer dependencies

No Launchpad package bundles optional integrations. Install them alongside `@bluecadet/launchpad`:

| Integration | Package |
|---|---|
| Sanity CMS | `@sanity/client` |
| Contentful | `contentful` |
| Airtable | `airtable` |
| Sanity portable text to HTML | `@portabletext/to-html` |
| Sanity block content to Markdown | `@sanity/block-content-to-markdown` |
| Sanity image URLs | `@sanity/image-url` |
| Sharp image processing | `sharp` |

The project generator (`npm create @bluecadet/launchpad`) installs only the peer dependencies you select.

## License notes

Bluecadet-authored Launchpad code is licensed under ISC. Third-party dependencies keep their own licenses.

`@bluecadet/launchpad-monitor` uses PM2 for process management. PM2 is licensed under AGPL-3.0, so review its terms before using, deploying, or redistributing the monitor package or the umbrella package that includes it.

PM2's license does not make the applications it manages AGPL-licensed. It affects compliance for the PM2 dependency itself:

- If you redistribute a bundle, installer, or machine image that includes PM2, preserve PM2's license notices and be ready to provide PM2 source as its license requires.
- If you modify PM2, those changes carry AGPL obligations, including source availability for users who interact with the modified PM2 over a network.
- Some organizations restrict AGPL dependencies. If yours does, install only the Launchpad packages you need or review the monitor package before adopting it.

This is a practical summary, not legal advice.
