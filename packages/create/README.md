# @bluecadet/create-launchpad

Scaffolding CLI for [Launchpad](https://bluecadet.github.io/launchpad/) projects.

## Usage

```bash
npm create @bluecadet/launchpad
```

The tool will interactively ask which plugins, sources, and transforms you need, then generate or update a config with explicit workflow orchestration. Observability is opt-in and is not selected by default:

- `launchpad.config.ts`
- `package.json` (created or merged)
- `tsconfig.json` (created or validated)
- `.gitignore` (optional)

After running, install the added dependencies:

```bash
npm install
```

If you scaffold the monitor plugin, the generated config includes both `workflows.start` and `workflows.stop` so PM2 apps connect, start, stop, and disconnect in the expected order.

If you select observability, the generated plugin remains disabled until `LAUNCHPAD_OBSERVABILITY_ENDPOINT` is present. `LAUNCHPAD_OBSERVABILITY_TOKEN` is optional. No client, project, installation, environment, organization, or other resource field is required.

The scaffolder does not generate an endpoint, token, or other credential. Enabling the plugin sends Launchpad logs and metrics only to the OTLP endpoint you configure. To identify the generated service, uncomment and edit the optional resource example in `launchpad.config.ts`:

```typescript
resource: { 'service.name': 'my-launchpad-service' },
```

You can add other flat primitive resource attributes when your deployment policy requires them.

## Docs

See [Creating a Project](https://bluecadet.github.io/launchpad/guides/creating-a-project) for full documentation.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
