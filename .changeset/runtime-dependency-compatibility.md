---
"@bluecadet/launchpad": patch
"@bluecadet/launchpad-cli": patch
"@bluecadet/launchpad-content": patch
"@bluecadet/launchpad-controller": patch
"@bluecadet/create-launchpad": patch
"@bluecadet/launchpad-monitor": patch
"@bluecadet/launchpad-observability": patch
"@bluecadet/launchpad-utils": patch
---

Update runtime dependencies and maintain compatibility with their latest APIs.

Refresh vulnerable transitive dependencies to patched releases, including brace-expansion, follow-redirects, and Axios, and refresh the documentation dependency graph to patched Astro, Solid, Seroval, js-yaml, and Undici releases. These updates use upstream-compatible version ranges without dependency overrides.

Raise the optional Contentful 9 peer dependency floor to 9.3.7, which supports patched Axios 1.x releases, while also explicitly supporting the Contentful 11 SDK used by the content package and its tests. Contentful 9 consumers can remain on that major by updating to `contentful@^9.3.7`. Refresh existing application lockfiles to pick up patched transitive dependencies, including Axios 1.20.0 or newer.
