# @bluecadet/create-launchpad

## 3.1.0

### Minor Changes

- [#308](https://github.com/bluecadet/launchpad/pull/308) [`7494861`](https://github.com/bluecadet/launchpad/commit/7494861d4cd1fdb4f041bc84f78d57581bd981e8) - Add a Scheduler option to the plugin prompt. When selected, the generated config imports `scheduler` from `@bluecadet/launchpad/scheduler`, adds a `scheduler({ 'content.fetch': '15m' })` entry with a link to the live content refresh guide, and adds `@bluecadet/launchpad-scheduler` to the generated dependencies. When Content is selected, the generated content config now also includes a commented-out `// versioning: true,` hint pointing at the same guide.

### Patch Changes

- [#310](https://github.com/bluecadet/launchpad/pull/310) [`72e1ee7`](https://github.com/bluecadet/launchpad/commit/72e1ee772a035cb55baa7b7944db9502377d3423) - The generated scheduler config now includes a comment pointing at `refetchChecker` and the `refetch.check` command for fast schedules.

## 1.1.0

### Minor Changes

- [#280](https://github.com/bluecadet/launchpad/pull/280) [`076eb64`](https://github.com/bluecadet/launchpad/commit/076eb640ecc2fd6db3d19e6ca4205df8eaf54bcc) - Introduces `@bluecadet/create-launchpad`, a scaffolding CLI invoked via `npm create @bluecadet/launchpad`. Interactively guides users through selecting plugins (content, monitor), sources, and transforms, then generates or patches `package.json`, `tsconfig.json`, `launchpad.config.ts`, and `.gitignore`.
