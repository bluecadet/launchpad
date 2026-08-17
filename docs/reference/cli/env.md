# Environment Variables

The `launchpad-cli` package supports loading environment variables from `.env` files using the `--env` and `--env-cascade` flags. This allows you to manage different configurations for various environments (development, staging, production, etc.).

## Usage

To load environment variables from a `.env` file:

```bash
npx launchpad --env .env
```

You can also load multiple `.env` files in sequence:

```bash
npx launchpad --env .env.local --env .env
```

When loading multiple files, variables from later files will override those from earlier files if they share the same name.

### Environment Cascading

The `--env-cascade` flag provides an automated way to load multiple environment files in a specific order. For example:

```bash
npx launchpad --env-cascade production
```

This will load files in the following order:

1. `.env`
2. `.env.local`
3. `.env.production`
4. `.env.production.local`

## Best Practices

- **Environment-Specific Files**: Create separate `.env` files for different environments:
  - `.env.development` for development settings
  - `.env.staging` for staging settings
  - `.env.production` for production settings

- **Security**:
  - Keep sensitive data (API keys, passwords) in local `.env` files that aren't committed
  - Use `.env.local` for machine-specific overrides

- **Documentation**:
  - Create a `.env.example` file
  - List all required variables with example values
  - Include this file in version control

Example `.env.example`:

```sh
# API Configuration
API_KEY=your_api_key_here
API_URL=https://api.example.com

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```
