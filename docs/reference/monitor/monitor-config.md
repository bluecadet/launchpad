# Monitor Config

Configuration for managing process monitoring, window management, and logging settings.

## Options

### `apps`

- **Type:** `Array<AppConfig>`
- **Default:** `[]`

A list of apps to launch and monitor. Each app can be configured with PM2 settings, window management options, and logging preferences.

For detailed app configuration options, see [App Config](#app-config).

### `deleteExistingBeforeConnect`

- **Type:** `boolean`
- **Default:** `true`

When enabled, deletes existing PM2 processes before connecting. Useful for volatile apps or when node processes might quit unexpectedly, ensuring a clean slate on startup.

### `windowsApi`

- **Type:** `WindowsApiConfig`
- **Default:** `{}`

Advanced configuration for the Windows API, used for managing foreground/minimized/hidden windows. Window operations are Windows-only; PM2 process management and logging work independently of them. See [Windows window management](./index.md#windows-window-management) for platform and installation details.

#### `debounceDelay`

- **Type:** `number`
- **Default:** `3000`

The delay (in milliseconds) until windows are ordered after launch. If your app takes a long time to open all of its windows, set this to a higher value to ensure it can be on top of the launchpad terminal window. Higher values also reduce CPU load if apps relaunch frequently.

### `shutdownOnExit`

- **Type:** `boolean`
- **Default:** `true`

When enabled, listens for exit events to handle graceful shutdown.

## App Config

Each app in the `apps` array can have the following configuration:

### `pm2`

- **Type:** `pm2.StartOptions`

PM2 configuration for the app. See [PM2 documentation](https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available) for available options.

### `windows`

- **Type:** `WindowConfig`
- **Default:** `{}`

Settings for window management on Windows. All flags default to `false` and apply to the app's visible top-level windows matched by its PM2 process ID:

- `foreground`: Request foreground placement after launch. Windows focus restrictions can prevent activation.
- `minimize`: Minimize windows after launch.
- `hide`: Hide windows after launch. Hidden windows may interfere with GUI-based apps.

Window operations are scheduled after launch using `windowsApi.debounceDelay`. They run asynchronously; the existing PM2 configuration and launch ordering are unchanged. On non-Windows platforms these settings do not perform window operations.

### `logging`

- **Type:** `AppLogConfig`
- **Default:** `{}`

Settings for log management:

- `logToLaunchpadDir`: Route logs to launchpad's directory
- `mode`: Log capture method ('bus' or 'file')
- `showStdout`: Include stdout output
- `showStderr`: Include stderr output
