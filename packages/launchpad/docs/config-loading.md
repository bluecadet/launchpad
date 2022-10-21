# Config Loading

- By default, Launchpad looks for `launchpad.json` or `config.json` at the cwd (where you ran `npx launchpad`/`launchpad` from)
- You can change the default path with `--config=<YOUR_FILE_PATH>` (e.g. `npx launchpad --config=../settings/my-config.json`)
- If no config is found, Launchpad will traverse up directories (up to 64) to find one
- All config values can be overridden via `--foo=bar` (e.g. `--logging.level=debug`)