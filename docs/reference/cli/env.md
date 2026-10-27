# Environment variables

The `launchpad-cli` package loads environment variables from `.env` files with the `--env` and `--env-cascade` flags. Use them to keep separate settings for development, staging, production, and other environments.

## Usage

Load a single `.env` file:

```bash
npx launchpad --env .env
```

Load several `.env` files in sequence:

```bash
npx launchpad --env .env.local --env .env
```

When two files define the same variable, the first file loaded wins.

### Environment cascading

`--env-cascade` loads a fixed set of environment files. For example:

```bash
npx launchpad --env-cascade production
```

This loads these files, from lowest to highest precedence:

1. `.env`
2. `.env.local`
3. `.env.production`
4. `.env.production.local`

## Best practices

- Create a separate `.env` file for each environment:
  - `.env.development` for development settings
  - `.env.staging` for staging settings
  - `.env.production` for production settings
- Keep secrets such as API keys and passwords in local `.env` files that aren't committed.
- Use `.env.local` for machine-specific overrides.
- Commit a `.env.example` file that lists every required variable with an example value.

Example `.env.example`:

```sh
# API Configuration
API_KEY=your_api_key_here
API_URL=https://api.example.com

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```
