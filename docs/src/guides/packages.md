# Packages and Modularity

Launchpad is published as a set of focused npm packages under the `@bluecadet` scope. This page explains the structure, why it exists, and how to choose what to install.

## The umbrella package

`@bluecadet/launchpad` is the recommended starting point. It re-exports all first-party plugins through scoped subpaths:

```
@bluecadet/launchpad/cli        → defineConfig, config loading
@bluecadet/launchpad/content    → content syncing plugin and types
@bluecadet/launchpad/monitor    → process monitoring plugin and types
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

## License notes

Bluecadet-authored Launchpad code is licensed under ISC. Third-party dependencies retain their own licenses.

`@bluecadet/launchpad-monitor` depends on PM2 for process management. PM2 is licensed under AGPL-3.0, so review PM2's license terms when using, deploying, or redistributing the monitor package or the umbrella package that includes it.

In practice, PM2's license does not make applications managed by PM2 become AGPL-licensed. The main impact is on compliance for the PM2 dependency itself:

- If you redistribute a bundle, installer, or machine image that includes PM2, preserve PM2's license notices and be prepared to provide PM2 source as required by its license.
- If you modify PM2 itself, expect those PM2 changes to carry AGPL obligations, including source availability for users who interact with the modified PM2 over a network.
- Some organizations restrict AGPL dependencies. If that applies to your project, install only the Launchpad packages you need or review the monitor package before adopting it.

This is a practical summary, not legal advice.
