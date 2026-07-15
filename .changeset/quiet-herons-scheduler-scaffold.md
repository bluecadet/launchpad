---
"@bluecadet/create-launchpad": minor
---

Add a Scheduler option to the plugin prompt. When selected, the generated config imports `scheduler` from `@bluecadet/launchpad/scheduler`, adds a `scheduler({ 'content.fetch': '15m' })` entry with a link to the live content refresh guide, and adds `@bluecadet/launchpad-scheduler` to the generated dependencies. When Content is selected, the generated content config now also includes a commented-out `// versioning: true,` hint pointing at the same guide.
