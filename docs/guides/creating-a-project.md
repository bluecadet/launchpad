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

Observability is not selected by default. If you opt in, the generated config sends logs and metrics to an OTLP endpoint only when all required variables are set:

```dotenv
LAUNCHPAD_OBSERVABILITY_ENDPOINT=https://telemetry.example.com
LAUNCHPAD_OBSERVABILITY_CLIENT=example-client
LAUNCHPAD_OBSERVABILITY_PROJECT=example-project
LAUNCHPAD_OBSERVABILITY_INSTALLATION=lobby-kiosk
LAUNCHPAD_OBSERVABILITY_ENVIRONMENT=production
# Optional:
LAUNCHPAD_OBSERVABILITY_TOKEN=
```

The generator does not create secrets or configure a Bluecadet endpoint. Treat the endpoint and token as deployment secrets. If the required variables are absent, the generated config omits the observability plugin rather than sending data to a default service. See [Observability](../reference/observability/index.md) for the data sent and privacy limits.

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
