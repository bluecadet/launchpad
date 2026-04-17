# Packages and Modularity

Launchpad is published as a set of focused npm packages under the `@bluecadet` scope. This page explains the structure, why it exists, and how to choose what to install.

## The umbrella package

`@bluecadet/launchpad` is the recommended starting point. It re-exports all first-party plugins through scoped subpaths:

```
@bluecadet/launchpad/cli        → defineConfig, config loading
@bluecadet/launchpad/content    → content syncing plugin and types
@bluecadet/launchpad/monitor    → process monitoring plugin and types
@bluecadet/launchpad/dashboard  → web dashboard plugin and types
@bluecadet/launchpad/controller → IPC and process orchestration
```

Subpath imports are also available for granular access:

```
@bluecadet/launchpad/content/sources          → all source adapters
@bluecadet/launchpad/content/sources/airtable → Airtable source only
@bluecadet/launchpad/content/transforms       → all transform plugins
@bluecadet/launchpad/content/transforms/sharp → Sharp image transform only
```

## Why separate packages underneath?

The umbrella wraps these individual packages: `@bluecadet/launchpad-cli`, `@bluecadet/launchpad-content`, `@bluecadet/launchpad-monitor`, and so on. They exist as standalone packages for three reasons:

**Independent features.** Content syncing and process monitoring are genuinely separate concerns. Many installations use only one. Publishing them separately means users who want only `monitor` don't need to install the content pipeline at all.

**Optional peer dependencies.** Integrations with third-party services (Sanity, Airtable, Contentful, sharp image processing) bring in substantial dependencies. These are `peerDependencies` on the individual packages, so you only pay that cost when you actually use them. The project generator adds the right peer deps automatically.

**Plugin parity.** Launchpad is built on a plugin model where first-party and third-party plugins are equivalent npm packages. Keeping the built-in plugins as standalone packages reinforces that — a community plugin follows the same pattern.

## Individual packages vs. the umbrella

Both work identically:

```typescript
// Umbrella (recommended)
import { content } from '@bluecadet/launchpad/content';

// Individual package (identical at runtime)
import { content } from '@bluecadet/launchpad-content';
```

The umbrella is a thin re-export layer — there's no extra code, no version drift, no runtime overhead. It's purely a convenience for installation and imports.

**Use the umbrella when** you want a single install and don't need fine-grained control over which packages are installed.

**Use individual packages when** you're building a custom plugin, writing library code that depends on only one Launchpad feature, or managing versions independently.

## Peer dependencies

Optional integrations are not bundled in any Launchpad package. Install them alongside `@bluecadet/launchpad`:

| Integration | Package |
|---|---|
| Sanity CMS | `@sanity/client` |
| Contentful | `contentful` |
| Airtable | `airtable` |
| Sanity portable text → HTML | `@portabletext/to-html` |
| Sanity block content → Markdown | `@sanity/block-content-to-markdown` |
| Sanity image URLs | `@sanity/image-url` |
| Sharp image processing | `sharp` |

The project generator (`npm create @bluecadet/launchpad`) selects and installs only the peer deps you need.
