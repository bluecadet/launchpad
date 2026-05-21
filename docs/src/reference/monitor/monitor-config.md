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

Advanced configuration for the Windows API, used for managing foreground/minimized/hidden windows.

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

Settings for window management:

- `foreground`: Move to foreground after launch
- `minimize`: Minimize windows after launch
- `hide`: Hide windows after launch

### `logging`

- **Type:** `AppLogConfig`
- **Default:** `{}`

Settings for log management:

- `logToLaunchpadDir`: Route logs to launchpad's directory
- `mode`: Log capture method ('bus' or 'file')
- `showStdout`: Include stdout output
- `showStderr`: Include stderr output
