# Creating a project

The `create-launchpad` project generator sets up a new Launchpad project or adds Launchpad to an existing one.

## Quick start

```bash
npm create @bluecadet/launchpad
```

The generator:

1. Asks which directory to set up (defaults to the current directory)
2. Asks which plugins you need (content, monitor, scheduler, and optional observability)
3. Asks which content sources and transforms to configure
4. Generates or updates the necessary files

Then install the dependencies it added:

```bash
npm install
```

## Generated files

### `launchpad.config.ts`

The main configuration file. The generator never overwrites an existing `launchpad.config.ts`; update it by hand.

### Optional observability

Observability is off by default. If you opt in, the generated config sends logs and metrics to an OTLP endpoint only when `LAUNCHPAD_OBSERVABILITY_ENDPOINT` is set:

```dotenv
LAUNCHPAD_OBSERVABILITY_ENDPOINT=https://telemetry.example.com
# Optional: leave blank for unauthenticated requests.
LAUNCHPAD_OBSERVABILITY_TOKEN=
```

If the token is missing, empty, or whitespace, requests go out without authentication. A nonblank token is passed through unchanged.

The generator creates no environment file, secrets, or Bluecadet endpoint. Treat the endpoint and token as deployment secrets. Without an endpoint, the generated config omits the observability plugin instead of sending data to a default service.

The generated destination uses OTLP/HTTP JSON. A commented `encoding: 'protobuf'` option selects binary OTLP/HTTP protobuf if your recipient supports it; this is not gRPC. Protobuf needs no extra environment variable or generator prompt.

Once the endpoint is set, log export reads the controller's retained canonical JSONL and keeps a checkpoint per destination. A new destination starts at the oldest retained record. This backfill can raise ingestion costs, and the backend may reject old timestamps. The generated config includes a commented `logStorage: { type: 'memory' }` opt-out for ephemeral delivery. Review the [delivery configuration](/reference/observability/observability-config/#logstorage) before enabling export.

No client, project, installation, environment, or organization value is required. To set a custom service name, edit the commented example:

```typescript
resource: { 'service.name': 'my-launchpad-service' },
```

Add other flat string, finite number, or boolean resource attributes there if your deployment policy requires them. If `resource` is omitted, Launchpad defaults `service.name` to `launchpad` and generates `service.instance.id` at runtime. See [Observability](../reference/observability/index.md) for the data sent and privacy limits.

### `package.json`

If no `package.json` exists, the generator creates one with the required dependencies, scripts, and `@types/node` as a dev dependency.

If one exists, the generator merges into it:
- Adds missing dependencies, including `@types/node` as a dev dependency, without changing existing version pins
- Adds `content`, `start`, and `stop` scripts without overwriting existing scripts

### `tsconfig.json`

If no `tsconfig.json` exists, the generator writes a minimal ESM-compatible one:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

If one exists, the generator checks it for ESM compatibility and patches simple gaps, such as a missing `esModuleInterop`. It warns about settings it cannot safely fix, such as `"module": "CommonJS"`, which Launchpad does not support.

### `.gitignore`

With your confirmation, the generator adds `node_modules/`, `dist/`, `.launchpad/`, `.downloads/`, and `.logs/` to `.gitignore`, skipping entries already present.

## Re-running

Run `npm create @bluecadet/launchpad` again in the same directory to add plugins. The generator merges `package.json` and `tsconfig.json` as described above but leaves `launchpad.config.ts` untouched, so add the new plugins to it by hand.

## Manual setup

See [Getting started](./getting-started.md) to install Launchpad by hand.
