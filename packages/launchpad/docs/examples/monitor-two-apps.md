# Example: Monitor Two Apps

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