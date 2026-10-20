---
"@bluecadet/launchpad-content": patch
---

Fix the documented named imports from source and transform subpaths (for example `import { sanitySource } from "@bluecadet/launchpad/content/sources/sanity"`), which previously failed because those modules only had a default export.

Sources and transforms are now named exports only. If you default-imported them from `@bluecadet/launchpad-content/sources/*` or `@bluecadet/launchpad-content/transforms/*`, switch to the named import:

```ts
// before
import sanitySource from "@bluecadet/launchpad-content/sources/sanity";
// after
import { sanitySource } from "@bluecadet/launchpad-content/sources/sanity";
```
