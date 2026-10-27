# Serving static web apps with Launchpad monitor

Use Launchpad's monitor to serve a static web app with PM2's built-in `serve` script, and optionally open it in a kiosk-mode browser.

## Configuration

```typescript
import { defineConfig } from '@bluecadet/launchpad/cli';
import { monitor } from '@bluecadet/launchpad/monitor';
import path from 'path';
import { homedir } from 'os';

export default defineConfig({
  plugins: [
    monitor({
      apps: [
        // Static web server
        {
          pm2: {
            name: "webapp-server",
            script: "serve",       // Uses PM2's built-in serve functionality
            cwd: "./apps/webapp",  // Path to your web app folder
            env: {
              PM2_SERVE_PATH: "./dist/",         // Path to static files
              PM2_SERVE_PORT: "8080",            // Port to serve on
              PM2_SERVE_SPA: "true",             // Enable single-page app mode
              PM2_SERVE_HOMEPAGE: "/index.html"  // Default page
            }
          }
        },

        // Browser to display the web app (optional)
        {
          pm2: {
            name: "webapp-browser",
            // Path to Chromium (adjust for your environment)
            cwd: path.resolve(homedir(), "AppData/Local/Chromium/Application"),
            script: "chrome.exe",
            args: "--kiosk --incognito --disable-pinch --overscroll-history-navgation=0 --enable-auto-reload --autoplay-policy=no-user-gesture-required http://localhost:8080"
          },
          windows: {
            foreground: true // Bring browser to foreground
          },
          logging: {
            showStdout: false, // Reduce console noise
            showStderr: false
          }
        }
      ]
    })
  ],
});
```

## The configured apps

### Server app

The first app serves the files:

- `script: "serve"` selects PM2's static file server
- `PM2_SERVE_PATH` sets the directory to serve
- `PM2_SERVE_PORT` sets the port
- `PM2_SERVE_SPA: "true"` enables single-page app mode, routing all requests to index.html
- `PM2_SERVE_HOMEPAGE` sets the default page

### Browser app (optional)

The second app opens the served content in Chromium. It runs in kiosk mode (full screen, minimal UI), uses flags suited to exhibition use, loads the local URL, and stays in the foreground.

## Common customizations

### Change the port

```javascript
env: {
  PM2_SERVE_PORT: "3000", // Change to your preferred port
}
```

Update the URL in the browser `args` to match.

### Enable HTTPS

```javascript
env: {
  PM2_SERVE_PATH: "./dist/",
  PM2_SERVE_PORT: "8443",
  PM2_SERVE_SPA: "true",
  PM2_SERVE_HOMEPAGE: "/index.html",
  PM2_SERVE_SSL_KEY: "./path/to/key.pem",   // Path to SSL key
  PM2_SERVE_SSL_CERT: "./path/to/cert.pem"  // Path to SSL certificate
}
```

### Chrome/Chromium flags

Common kiosk flags:

- `--kiosk`: Full-screen kiosk mode
- `--incognito`: Private browsing mode
- `--disable-pinch`: Disable pinch zoom
- `--overscroll-history-navigation=0`: Disable swipe navigation
- `--enable-auto-reload`: Reload the page after a crash
- `--autoplay-policy=no-user-gesture-required`: Allow media autoplay

### Other browsers

Firefox:

```javascript
{
  pm2: {
    name: "webapp-firefox",
    cwd: "C:/Program Files/Mozilla Firefox",
    script: "firefox.exe",
    args: "-kiosk http://localhost:8080"
  }
}
```

## Troubleshooting

### Server won't start

- Make sure PM2 can find the `serve` module
- Check that the path contains static web files
- Check that the port is free

### Browser doesn't launch

- Check the browser path for your system
- Check the URL and confirm the server is running
- Check the flags against your browser version

### Page doesn't load properly

- In SPA mode, make sure your app is built as a single-page app
- For other sites, set `PM2_SERVE_SPA` to `"false"`


