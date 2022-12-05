# Launchpad Monitor

The [`@bluecadet/launchpad-monitor`](https://www.npmjs.com/package/@bluecadet/launchpad-monitor) package launches and monitors any number of apps.

Under the hood, it uses PM2 for process management, and adds a few features like window foregrounding and minimizing.

## Configuration

1. Create a `monitor` section in your `launchpad.json` (see [`MonitorOptions`](#MonitorOptions)).
2. Add a list of app option objects in `monitor.apps` (see [`AppOptions`](#AppOptions)).
3. Each app requires a `pm2` block, which requires a `name` and `script` as a minimum. See [PM2 docs](https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available) for all supported settings.
4. Run `npx launchpad monitor` (or `npx launchpad` to update content first if configured)

```json
{
  "monitor": {
    "apps": [
      {
        "pm2": {
          "name": "my-app",
          "script": "my-app.exe"
        }
      }
    ]
  }
}
```

Apps will be relaunched individually as soon as they exit.


###  MonitorOptions
Top-level options of Launchpad Monitor.


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_monitor-options.MonitorOptions+apps">`apps`</a> |  <code>Array.&lt;AppOptions&gt;</code>|  <code>[]</code>  | A list of `AppOptions` to configure which apps to launch and monitor. |
| <a name="module_monitor-options.MonitorOptions+deleteExistingBeforeConnect">`deleteExistingBeforeConnect`</a> |  <code>boolean</code>|  <code>false</code>  | Set this to true to delete existing PM2 processes before connecting. If you're running volatile apps or your node process might be quit unexpectedly, this can be helpful to start with a clean slate on startup. |
| <a name="module_monitor-options.MonitorOptions+windowsApi">`windowsApi`</a> |  <code>WindowsApiOptions</code>|  | Advanced configuration for the Windows API, e.g. for managing foreground/minimized/hidden windows. |

###  AppOptions
Options for an individual app to monitor.


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_monitor-options.AppOptions+pm2">`pm2`</a> |  <code>pm2.StartOptions</code>|  <code>null</code>  | Configure which app to launch and how to monitor it here.<br><br>See: https://pm2.keymetrics.io/docs/usage/application-declaration/#attributes-available |
| <a name="module_monitor-options.AppOptions+windows">`windows`</a> |  <code>WindowOptions</code>|  <code>new WindowOptions()</code>  | Optional settings for moving this app's main windows to the foreground, minimize or hide them. |
| <a name="module_monitor-options.AppOptions+logging">`logging`</a> |  <code>AppLogOptions</code>|  <code>new AppLogOptions()</code>  | Optional settings for how to log this app's output. |

###  WindowOptions
Options for how an app's windows should be managed.


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_monitor-options.WindowOptions+foreground">`foreground`</a> |  <code>boolean</code>|  <code>false</code>  | Move this app to the foreground once all apps have been launched. |
| <a name="module_monitor-options.WindowOptions+minimize">`minimize`</a> |  <code>boolean</code>|  <code>false</code>  | Minimize this app's windows once all apps have been launched. |
| <a name="module_monitor-options.WindowOptions+hide">`hide`</a> |  <code>boolean</code>|  <code>false</code>  | Completely hide this app's windows once all apps have been launched. Helpful for headless apps, but note that this might cause issues with GUI-based apps. |

## Example: Monitor Two Apps

The following `launchpad.json` will launch and monitor two apps. The first app window will be foregrounded after launch, the second app will be minimized. If any of the apps exit, PM2 will relaunch them.

```json
{
  "monitor": {
    "apps": [
      {
        "pm2": {
          "name": "main-app",
          "script": "my-main-app.exe",
          "cwd": "../apps/"
        },
        "windows": {
          "foreground": true
        }
      },
      {
        "pm2": {
          "name": "side-app",
          "script": "my-side-app.exe",
          "cwd": "../apps/",
          "args": "--custom-arg=true"
        },
        "windows": {
          "minimize": true
        }
      }
    ]
  }
}
```

## Logging App Output

To capture your apps' logs in Launchpad Monitor you need to ensure that your apps are routing them to `stdout` and `stderr`.

### Unity

To redirect Unity's logs to stdout and stderr, launch your app using the `-logfile -` argument:

```json
{
  "monitor": {
    "apps": [
      {
        "name": "unity-app",
        "script": "UnityPM2Test.exe",
        "args": "-logfile -"
      }
    ]
  }
}
```

### Cinder

- Cinder doesn't route logs directly to `std::cout` and `std::cerr` by default, so this has to be done manually. See [here](https://github.com/bluecadet/Cinder-BluecadetViews/blob/2333604abc44a719e18df67566135ea34d545085/src/bluecadet/core/BaseApp.cpp#L22-L39) for an example for how to create one, and [here](https://github.com/bluecadet/Cinder-BluecadetViews/blob/2333604abc44a719e18df67566135ea34d545085/src/bluecadet/core/BaseApp.cpp#L86) for how to add it.
- If you use [Cinder-BluecadetViews](https://github.com/bluecadet/Cinder-BluecadetViews), all logs are routed to `stdout`/`stderr` via the `logToStdOut` setting. This is set to `true` by default and can otherwise be configured in `settings.json` or via cli flag: `my-app.exe console=false logToStdOut=true`

## Adanced Configuration

See below for further settings that can be configured globally and on a per-app level.


###  WindowsApiOptions
Global options for how window order should be managed.


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_monitor-options.WindowsApiOptions+nodeVersion">`nodeVersion`</a> |  <code>string</code>|  <code>'>=17.4.0'</code>  | The minimum major node version to support window ordering.<br>Node versions < 17 seem to have a fatal bug with the native<br>API, which will intermittently cause V8 to crash hard.<br><br>See: https://github.com/node-ffi-napi/ref-napi/issues/54#issuecomment-1029639256 |
| <a name="module_monitor-options.WindowsApiOptions+debounceDelay">`debounceDelay`</a> |  <code>number</code>|  <code>3000</code>  | The delay until windows are ordered after launch of in ms.<br><br>If your app takes a long time to open all of its windows, set this number to a higher value to ensure it can be on top of the launchpad terminal window.<br><br>Keeping this high also reduces the CPU load if apps relaunch often. |


###  AppLogOptions
Options for how an app's logs should be saved, routed and displayed.


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_monitor-options.AppLogOptions+logToLaunchpadDir">`logToLaunchpadDir`</a> |  <code>boolean</code>|  <code>true</code>  | Route application logs to launchpad's log dir instead of pm2's log dir. |
| <a name="module_monitor-options.AppLogOptions+mode">`mode`</a> |  <code>&#x27;bus&#x27;</code> \| <code>&#x27;file&#x27;</code>|  <code>'bus'</code>  | How to grab the app's logs. Supported values:<br>- `'bus'`: Logs directly from the app's stdout/stderr bus. Can result in interrupted logs if the buffer isn't consistently flushed by an app.<br>- `'file'`: Logs by tailing the app's log files. Slight lag, but can result in better formatting than bus. Not recommended, as logs cannot be rotated by launchpad. |
| <a name="module_monitor-options.AppLogOptions+showStdout">`showStdout`</a> |  <code>boolean</code>|  <code>true</code>  | Whether or not to include output from `stdout` |
| <a name="module_monitor-options.AppLogOptions+showStderr">`showStderr`</a> |  <code>boolean</code>|  <code>true</code>  | Whether or not to include output from `stderr` |
