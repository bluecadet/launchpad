const config = {
  "apps": [
    {
      "pm2": {
        "name": "ping bluecadet.com",
        "script": "cmd.exe",
        "args": "/c ping -n -1 bluecadet.com",
      },
      "windows": {
        "minimize": false,
        "foreground": true,
        "hide": false,
      },
      "logging": {
        "logToLaunchpadDir": true,
        "showStdout": true,
        "showStderr": true,
        "mode": "file"
      }
    },
    {
      "pm2": {
        "name": "ping google.com",
        "script": "cmd.exe",
        "args": "/c ping -n -1 google.com",
      },
      "windows": {
        "minimize": true,
        "foreground": false,
        "hide": false,
      },
      "logging": {
        "logToLaunchpadDir": true,
        "showStdout": true,
        "showStderr": true,
        "mode": "bus"
      }
    },
    {
      "pm2": {
        "name": "ping bluecadet.com via bat",
        "script": "cmd.exe",
        "args": "/c test\\ping.bat",
      },
      "windows": {
        "minimize": false,
        "foreground": true,
        "hide": false,
      },
      "logging": {
        "logToLaunchpadDir": true,
        "showStdout": true,
        "showStderr": true,
        "mode": "file"
      }
    },
  ]
};

export default config;
