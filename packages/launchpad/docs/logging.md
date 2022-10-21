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

All of the below settings can be configured via `launchpad.json` or by passing in the appropriate CLI launch flag (e.g. `--logging.fileOptions.dirname=my-logs` to save logs to `my-logs/`) example with default settings:

```json
{
  "logging": {
    "level": "info",
    "filename": "%DATE%-%LOG_TYPE%",
    "fileOptions": {
      "extension": ".log",
      "dirname": ".logs",
      "maxSize": "20m",
      "maxFiles": "28d",
      "datePattern": "YYYY-MM-DD",
    }
  }
}
```
