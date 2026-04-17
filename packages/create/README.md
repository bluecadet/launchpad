# @bluecadet/create-launchpad

Scaffolding CLI for [Launchpad](https://bluecadet.github.io/launchpad/) projects.

## Usage

```bash
npm create @bluecadet/launchpad
```

The tool will interactively ask which plugins, sources, and transforms you need, then generate or update a config with explicit workflow orchestration:

- `launchpad.config.ts`
- `package.json` (created or merged)
- `tsconfig.json` (created or validated)
- `.gitignore` (optional)

After running, install the added dependencies:

```bash
npm install
```

If you scaffold the monitor plugin, the generated config includes both `workflows.start` and `workflows.stop` so PM2 apps connect, start, stop, and disconnect in the expected order.

## Docs

See [Creating a Project](https://bluecadet.github.io/launchpad/guides/creating-a-project) for full documentation.
