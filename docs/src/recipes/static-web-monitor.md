# Serving Static Web Apps with Launchpad Monitor

This recipe demonstrates how to use Launchpad's monitor functionality to serve static web applications using PM2's built-in serve capability, and optionally launch a browser to display them in kiosk mode.

## Configuration

```typescript
import { defineConfig } from '@bluecadet/launchpad-cli';
import { monitor } from '@bluecadet/launchpad-monitor';
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

## How It Works

### The Server App

The first app in the configuration uses PM2's built-in `serve` functionality:

- `script: "serve"` tells PM2 to use its static file server
- `PM2_SERVE_PATH` specifies which directory to serve
- `PM2_SERVE_PORT` sets the port number
- `PM2_SERVE_SPA: "true"` enables Single Page App support (routes all requests to index.html)
- `PM2_SERVE_HOMEPAGE` sets the default page

### The Browser App (optional)

The second app launches a browser to display your web content:

- Uses Chromium in kiosk mode (full-screen, minimal UI)
- Includes flags to optimize for exhibition use
- Automatically navigates to the locally served content
- Is configured to stay in the foreground

## Common Customizations

### Change the Port

```javascript
env: {
  PM2_SERVE_PORT: "3000", // Change to your preferred port
}
```

Don't forget to update the URL in the browser args too!

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

### Chrome/Chromium Flags

Common flags for kiosk applications:

- `--kiosk`: Full-screen kiosk mode
- `--incognito`: Private browsing mode
- `--disable-pinch`: Disable pinch zoom
- `--overscroll-history-navigation=0`: Disable swipe navigation
- `--enable-auto-reload`: Auto-refresh on crashes
- `--autoplay-policy=no-user-gesture-required`: Allow autoplay of media

### Using Other Browsers

For Firefox:

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

- Ensure the `serve` module is available to PM2
- Check that the specified path contains static web files
- Verify the port isn't already in use

### Browser doesn't launch

- Verify the browser path is correct for your system
- Check that the URL is correct and the server is running
- Some browser flags may differ between versions

### Page doesn't load properly

- If using SPA mode, ensure your app is built as a proper SPA
- For non-SPA sites, set `PM2_SERVE_SPA` to `"false"`


