# Logging

All logs are routed to and handled by [Winston](https://www.npmjs.com/package/winston) by the [LogManager](packages\utils\lib\log-manager.js) class.

Logs are funneled to:
- The console with colorization
- Launchpad log files for `info`, `error` and `debug` with no colorization
- App log files for `stdout` and `stderr` with no colorization

## Configuration

To log everything up to the debug level, you can start launchpad with:

```
npx launchpad --logging.level=debug
```

Available log levels are: error

0. `error`
1. `warn`
2. `info`
3. `http`
4. `verbose`
5. `debug`
6. `silly`

All settings can be configured via `launchpad.json` or by passing in the appropriate CLI launch flag (e.g. `--logging.fileOptions.dirname=my-logs` to save logs to `my-logs/`).

## Capturing Application Logs

Launchpad routes all the `stdout` and `stderr` logs of all apps to the console and file based the settings [LogManager](packages\utils\lib\log-manager.js). See [Launchpad Monitor](/packages/monitor/README.md#logging-app-output) for more info.

## Advanced Configuration

See below for all available options and settings for logging.


###  LogOptions
Options object passed directly to Winston's constructor, with additional options for Launchpad logging.

See: https://github.com/winstonjs/winston#creating-your-own-logger for all available settings supported by Winston.
| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_log-manager.LogOptions+filename">`filename`</a> |  <code>string</code>|  <code>`%DATE%-%LOG\_TYPE%`</code>  | Where to save logs to. |
| <a name="module_log-manager.LogOptions+fileOptions">`fileOptions`</a> |  <code>LogFileOptions</code>|  <code>new LogFileOptions(fileOptions)</code>  | Options for individual files and streams. |
| <a name="module_log-manager.LogOptions+level">`level`</a> |  <code>string</code>|  <code>'info'</code>  | The maximum log level to display in all default logs. |
| <a name="module_log-manager.LogOptions+format">`format`</a> |  <code>winston.Logform.Format</code>|  <code>LogOptions.DEFAULT\_LOG\_FORMAT</code>  | The format for how each line is logged. |
| <a name="module_log-manager.LogOptions+overrideConsole">`overrideConsole`</a> |  <code>boolean</code>|  <code>true</code>  | Route all console logs to the log manager. This helps<br>ensure that logs are routed to files and rotated properly.<br><br>This will also freeze the console object, so it can't be<br>modified further during runtime.<br><br>All console logs will be prefixed with `(console)`. |


###  LogFileOptions


See: https://github.com/winstonjs/winston-daily-rotate-file#options
| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_log-manager.LogFileOptions+format">`format`</a> |  <code>winston.Logform.Format</code>|  <code>Uncolorized variant of LogOptions.DEFAULT\_LOG\_FORMAT</code>  | The format used for individual file logs. Uses the default log format but without colorization out of the box. |
| <a name="module_log-manager.LogFileOptions+extension">`extension`</a> |  <code>string</code>|  <code>'.log'</code>  | File extension. |
| <a name="module_log-manager.LogFileOptions+dirname">`dirname`</a> |  <code>string</code>|  <code>'.logs'</code>  | The directory under which all logs are saved. |
| <a name="module_log-manager.LogFileOptions+maxSize">`maxSize`</a> |  <code>string</code>|  <code>'20m'</code>  | The max size of each individual log file. |
| <a name="module_log-manager.LogFileOptions+maxFiles">`maxFiles`</a> |  <code>string</code>|  <code>'28d'</code>  | The maximum number of files to save per type. |
| <a name="module_log-manager.LogFileOptions+datePattern">`datePattern`</a> |  <code>string</code>|  <code>'YYYY-MM-DD'</code>  | The date pattern used in file names. |
