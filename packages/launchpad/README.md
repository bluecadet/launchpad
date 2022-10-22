# 🚀 Launchpad

Launchpad is a suite of tools to manage media installations. In a typicla usecase, it bootstraps up your Windows PC, downloads and caches CMS content and then launches and monitors your apps. It can:

- Launch, control and monitor muiltiple processes (via PM2)
- Download and locally cache content from various common web APIs
- Bootstrap PCs running Windows 8/10/11 with common exhibit settings
- Consolidate and route application logs
- [...and many more things](#more-features)

## Getting Started

1. Install: `npm i @bluecadet/launchpad`
2. Create a `launchpad.json` config (see [#Configuration](#Configuration))
3. *Optional: Bootstrap your PC with `npx launchpad scaffold`*
4. Run `npx launchpad`

Type `npx launchpad --help` for all available commands.

*Launchpad can also be installed globally via `npm i -g @bluecadet/launchpad` and called via `launchpad` instead of `npx launchpad`.*

## Configuration

Each [launchpad package](#packages) needs its own config section in `launchpad.json`.

### Example

A simple `launchpad.json` example to download content from Flickr and launch a single app:

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

### Documentation

For a full list of configuration options, review the documentation below:

- [`monitor`](/packages/monitor/README.md): Configures which apps to run
- [`content`](/packages/content/README.md): Configures which content to download
  - `sources`: An array containing one or more of the following content source options:
    - [`airtable`](/packages/content/docs/airtable-source.md): Download content from Airtable
    - [`contentful`](/packages/content/docs/contentful-source.md): Download content from Contentful
    - [`json`](/packages/content/docs/json-source.md): Download content from JSON endpoints
    - [`strapi`](/packages/content/docs/strapi-source.md): Download content from Strapi
    - [`sanity`](/packages/content/docs/sanity-source.md): Download content from Sanity
- [`logging`](/packages/launchpad/docs/logging.md): Configures how logs are routed to the console and to files
- [`hooks`](/packages/launchpad/docs/hooks.md): Run a script before or after a launchpad event (e.g. after content has been updated)

## Packages

This repo is a monorepo that includes the following packages:

* [`@bluecadet/launchpad`](/packages/launchpad)
* [`@bluecadet/launchpad-content`](/packages/content)
* [`@bluecadet/launchpad-dashboard`](/packages/dashboard) (wip)
* [`@bluecadet/launchpad-monitor`](/packages/monitor)
* [`@bluecadet/launchpad-scaffold`](/packages/scaffold)
* [`@bluecadet/launchpad-utils`](/packages/utils)

Each of these packages can be launched independently (except for utils), so if you only need app-monitoring or content updates, you can install only `@bluecadet/launchpad-monitor` or `@bluecadet/launchpad-content`.

## Requirements

Launchpad requires Node `>=17.5.0` and NPM `>=8.5.1` for Windows API integration and workspaces support.

We recommend installing the latest version of NodeJS and NPM via [nvm-windows](https://github.com/coreybutler/nvm-windows):

```
nvm install latest
nvm use latest
npm i -g npm@latest
```