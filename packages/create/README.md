# @bluecadet/create-launchpad

Scaffolding CLI for [Launchpad](https://bluecadet.github.io/launchpad/) projects.

## Usage

```bash
npm create @bluecadet/launchpad
```

The tool will interactively ask which plugins, sources, and transforms you need, then generate or update:

- `launchpad.config.ts`
- `package.json` (created or merged)
- `tsconfig.json` (created or validated)
- `.gitignore` (optional)

After running, install the added dependencies:

```bash
npm install
```

## Docs

See [Creating a Project](https://bluecadet.github.io/launchpad/guides/creating-a-project) for full documentation.
