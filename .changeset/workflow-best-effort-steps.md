---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-cli": patch
---

Workflows now run every step best-effort instead of halting on the first failure. A failed step is recorded and the remaining steps still run; the workflow reports an aggregated error at the end. This means a failed `content.fetch` no longer prevents `monitor.start` from launching apps against the last successfully published content. Wrap a step as `{ step: 'command.id', stopOnError: true }` to opt into the old halt-on-failure behavior for that step.
