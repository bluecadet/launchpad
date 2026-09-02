---
"@bluecadet/create-launchpad": minor
"@bluecadet/launchpad-docs": patch
---

Scaffolded projects now get a `README.md`. Previously a fresh Launchpad project had no file describing how to run it or how an app is supposed to talk to it, so the only hint anyone got toward the client SDK was a comment buried inside a commented-out `httpTransport` block in `launchpad.config.ts`.

The generated README opens with the project's package name, a one-line description, and a "Getting started" section listing `npm install` plus whichever scripts the scaffolder actually added to `package.json` — `npm run content` when the content plugin is selected, `npm run start` and `npm run stop` when the monitor plugin is selected. It closes with a short "Connecting an app" section naming `@bluecadet/launchpad-client` as the way a kiosk, a docent tablet, or another Node process should reach the controller's HTTP/SSE surface, and pointing at the client reference docs for the full API. It intentionally stays short and doesn't try to restate anything the docs site already covers.

Like `launchpad.config.ts`, the README follows a skip-if-exists rule: if a `README.md` is already present in the target directory, the generator leaves it untouched rather than overwriting or merging into it. This matters for the common re-run case — running `npm create @bluecadet/launchpad` again in a project that already has a README (hand-written or otherwise) won't clobber it.

The "What Gets Generated" section of the Creating a Project guide has a new `README.md` entry describing this behavior alongside the existing entries for `launchpad.config.ts`, `package.json`, `tsconfig.json`, and `.gitignore`.
