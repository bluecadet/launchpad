# 🚀 Launchpad

Launchpad is a suite of tools to manage media installations. In a typicla usecase, it bootstraps up your Windows PC, downloads and caches CMS content and then launches and monitors your apps. It can:

- Launch, control and monitor muiltiple processes (via PM2)
- Download and locally cache content from various common web APIs
- Bootstrap PCs running Windows 8/10/11 with common exhibit settings
- Consolidate and route application logs
- [...and many more things](#more-features)

## Getting Started

1. Install Launchpad dependency: `npm i @bluecadet/launchpad` (can also be installed globally via `npm i -g @bluecadet/launchpad`)
2. Create a `launchpad.json` config file (see [#Configuration](#Configuration))
3. Run `npx launchpad` (or `launchpad` if you installed globally)

*Optional: Bootstrap your PC with `npx launchpad scaffold` (or run [`/packages/scaffold/setup.bat`](/packages/scaffold/setup.bat) as an admin)*

Type `npx launchpad --help` for all available commands.

## Configuration

Launchpad has several independent submodules, each with their own config section in `launchpad.json`.

A simple example to download content from Flickr and launch a single exe:

```json
{
  "content": {
    "sources": [
      {
        "id": "flickr-images",
        "files": {
            "spaceships.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=spaceship",
            "rockets.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=rocket"
        }
      }
    ]
  },
  "monitor": {
    "apps": [
      {
        "pm2": {
          "name": "my-app",
          "script": "my-app.exe",
          "cwd": "./builds/"
        }
      }
    ]
  }
}
```

See the following classes for a full list of all available config options:

- `monitor`: ([`MonitorOptions`](/packages/monitor/lib/monitor-options.js)): Configures which apps to run
- `content`: ([`ContentOptions`](/packages/content/lib/content-options.js)): Configures which content to download
  - `sources`: An array containing any amount of the following content source options:
    - [`AirtableOptions`](/packages/content/lib/content-sources/airtable-source.js): Download content from Airtable
    - [`ContentfulOptions`](/packages/content/lib/content-sources/contentful-source.js): Download content from Contentful
    - [`JsonOptions`](/packages/content/lib/content-sources/json-source.js): Download content from JSON endpoints
    - [`StrapiOptions`](/packages/content/lib/content-sources/strapi-source.js): Download content from Strapi
- `logging`: ([`LogOptions`](/packages/utils/lib/log-manager.js)): Configures how logs are routed to the console and to files

## Packages

This repo is a monorepo that includes the following packages:

* [`@bluecadet/launchpad`](packages/launchpad)
* [`@bluecadet/launchpad-content`](packages/content)
* [`@bluecadet/launchpad-dashboard`](packages/dashboard)
* [`@bluecadet/launchpad-monitor`](packages/monitor)
* [`@bluecadet/launchpad-scaffold`](packages/scaffold)
* [`@bluecadet/launchpad-utils`](packages/utils)

Each of these packages can be launched independently (except for utils), so if you only need app-monitoring or content updates, you can install only `@bluecadet/launchpad-monitor` or `@bluecadet/launchpad-content`.

## Requirements

Launchpad requires Node `>=17.5.0` and NPM `>=8.5.1` for Windows API integration and workspaces support.

We recommend installing the latest version of NodeJS and NPM via [nvm-windows](https://github.com/coreybutler/nvm-windows):

```
nvm install latest
nvm use latest
npm i -g npm@latest
```

## More Features

- Insert custom hooks to run any command before or after content updates, app launches and more

### Monitoring
- Start, monitor (relaunch on crash/quit), and stop any number of apps in parallel
- Move specific apps to the foreground or minimize and hide them
- Apps are launched in sequence (e.g. if one app requires data from another)
- Log routing and filtering

### Content
- Supported sources:
  - JSON with asset urls
  - Airtable
  - Contentful
  - Sanity
  - Strapi (3.x.x)
- Caching using If-Modified-Since HTTP header and file-size checks
- Full rollback to previous content on download errors
- Text and image transforms (replace strings, scale images, ...)
- Concurrent downloads
- Multiple content sources for a single config
- Configurable via json

### Scaffolding
- Install common apps
- Configure Windows Explorer settings
- Configure Windows power settings to never sleep
- Create automatic daily launch tasks and reboots
- Disable updates, prompts, notifications, UI elements
- See [/packages/scaffold](./packages/scaffold) for more info

## Roadmap
- [ ] Web dashboard to manage apps and content
- [ ] API to manage apps and content
