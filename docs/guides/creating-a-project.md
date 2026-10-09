# Creating a Project

The easiest way to set up a new Launchpad project (or add Launchpad to an existing one) is with the `create-launchpad` project generator.

## Quick Start

```bash
npm create @bluecadet/launchpad
```

This command will:

1. Ask which directory to set up Launchpad in (defaults to the current directory)
2. Ask which plugins you need (content, monitor, scheduler, and optional observability)
3. Ask which content sources and transforms to configure
4. Generate or update the necessary files

Then install the dependencies it added:

```bash
npm install
```

## What Gets Generated

### `launchpad.config.ts`

The main configuration file. If a `launchpad.config.ts` already exists it will **not** be overwritten — the tool skips it and you can update it manually.

### Optional observability

Observability is not selected by default. If you opt in, the generated config sends logs and metrics to an OTLP endpoint only when `LAUNCHPAD_OBSERVABILITY_ENDPOINT` is set:

```dotenv
LAUNCHPAD_OBSERVABILITY_ENDPOINT=https://telemetry.example.com
# Optional:
LAUNCHPAD_OBSERVABILITY_TOKEN=
```

The generator does not create an environment file, secrets, or a Bluecadet endpoint. Treat the endpoint and token as deployment secrets. If the endpoint is absent, the generated config omits the observability plugin rather than sending data to a default service.

The generated destination uses OTLP/HTTP JSON by default. It includes a commented `encoding: 'protobuf'` option for selecting binary OTLP/HTTP protobuf when your recipient supports it; this is not gRPC. Enabling protobuf does not require another environment variable or generator prompt.

Once the endpoint is set, logs use the controller's retained canonical JSONL with per-destination checkpoints by default. A new destination starts at the oldest retained record: this backfill can increase ingestion costs, and the backend may reject old timestamps. The generated configuration includes a commented `logStorage: { type: 'memory' }` opt-out for ephemeral delivery. The plugin still requires `LAUNCHPAD_OBSERVABILITY_ENDPOINT` before it is added. Review the [delivery configuration](../reference/observability/observability-config.md#logstorage) before enabling export.

No client, project, installation, environment, or organization value is required. The generated config includes a commented example that you can edit when you want a custom service name:

```typescript
resource: { 'service.name': 'my-launchpad-service' },
```

You can add other flat string, finite number, or boolean resource attributes to that record when your deployment policy requires them. If `resource` is omitted, Launchpad defaults `service.name` to `launchpad` and generates `service.instance.id` at runtime. See [Observability](../reference/observability/index.md) for the data sent and privacy limits.

### `package.json`

If no `package.json` exists, one is created with the appropriate dependencies and scripts.

If one already exists, the tool **merges** into it:
- Adds any missing dependencies (without changing existing version pins)
- Adds `content`, `start`, and `stop` scripts (without overwriting scripts you already have)

### `tsconfig.json`

If no `tsconfig.json` exists, a minimal ESM-compatible one is generated:

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

If one already exists, the tool validates it for ESM compatibility and patches any easily-fixable gaps (like a missing `esModuleInterop`). It will warn you if it finds settings it cannot safely auto-fix (e.g. a `"module": "CommonJS"` setting that Launchpad is not compatible with).

### `.gitignore`

With your confirmation, the tool adds Launchpad-specific entries (`node_modules/`, `dist/`, `.launchpad/`, `.downloads/`) to your `.gitignore`. If entries are already present, they are not duplicated.

## Re-running

You can run `npm create @bluecadet/launchpad` again in the same directory to add more plugins. `package.json` and `tsconfig.json` will be merged as described above. The existing `launchpad.config.ts` will be left untouched — add the new plugins manually.

## Manual Setup

Prefer to set things up by hand? See [Getting Started](./getting-started.md) for step-by-step installation instructions.
