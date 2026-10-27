# @bluecadet/create-launchpad

Scaffolding CLI for [Launchpad](https://bluecadet.github.io/launchpad/) projects.

## Usage

Use Node.js 24.x or 26 and newer (`^24 || >=26`).

```bash
npm create @bluecadet/launchpad
```

The tool asks which plugins, sources, and transforms you need, then generates or updates these files with explicit workflow orchestration:

- `launchpad.config.ts`
- `package.json` (created or merged)
- `tsconfig.json` (created or validated)
- `.gitignore` (optional)

Generated `package.json` files declare the Node.js requirement. When updating an existing project, the scaffolder adds the requirement if it is missing and keeps any explicit Node engine declaration; make sure that range matches the supported runtime.

After the tool finishes, install the added dependencies:

```bash
npm install
```

If you scaffold the monitor plugin, the generated config includes `workflows.start` and `workflows.stop`, so PM2 apps connect, start, stop, and disconnect in order.

## Observability

Observability is opt-in and unselected by default. The scaffolder generates no endpoint, token, or other credential. The generated plugin stays disabled until `LAUNCHPAD_OBSERVABILITY_ENDPOINT` is set, and then sends Launchpad logs and metrics only to that OTLP endpoint.

`LAUNCHPAD_OBSERVABILITY_TOKEN` is optional. If it is missing, empty, or whitespace, requests go out without authentication. Nonblank tokens pass through unchanged. No client, project, installation, environment, organization, or other resource field is required.

To identify the generated service, uncomment and edit the optional resource example in `launchpad.config.ts`:

```typescript
resource: { 'service.name': 'my-launchpad-service' },
```

Add other flat primitive resource attributes if your deployment policy requires them.

Logs use the controller's retained canonical JSONL and per-destination checkpoints by default. The generated block includes a commented `logStorage: { type: 'memory' }` opt-out for ephemeral delivery. New destinations backfill from the oldest retained record, which can raise ingestion costs or hit backend timestamp limits; see the [delivery reference](https://launchpad.bluecadet.com/reference/observability/observability-config).

## Docs

See [Creating a Project](https://bluecadet.github.io/launchpad/guides/creating-a-project) for full documentation.

## License

Bluecadet-authored code in this package is licensed under ISC. Third-party dependencies retain their own licenses.
