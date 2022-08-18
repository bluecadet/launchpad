# 🚀 Launchpad

Launchpad is a suite of configuration-driven tools to manage media installations that can:

* Launch, control and monitor muiltiple processes (via PM2)
* Download and locally cache content from various common web APIs
* Bootstrap exhibition PCs running Windows 10 with common exhibit settings
* Consolidate and route application logs

<details>
  <summary>🔍 All Features</summary>

  - **App Monitoring**
    - Start, monitor (relaunch on crash/quit), and stop any number of apps in parallel
    - Control which apps are in the foreground, minimized or hidden
    - Apps are launched in sequence (e.g. if one app requires data from another)
    - Log routing and filtering
  - **Content Download and Caching**
    - Supported sources:
      - JSON with asset urls
      - Airtable API
      - Contentful API
      - Strapi API (3.x.x)
    - Caching using If-Modified-Since HTTP header
    - Full rollback to previous content on download errors
    - Text and image transforms (replace strings, scale images, ...)
    - Concurrent download
    - Multiple content sources for a single config
    - Configurable via json
    - Inheritable configs in the following order:
      1. `LaunchpadContent default values`
      2. `LaunchpadContent` instance `config` (passed via constructor)
      3. `ContentSource` instance `config` (passed via constructor)
  - **PC Setup and Scaffolding**
    - Install common apps
    - Configure Windows Explorer settings
    - Configure Windows power settings to never sleep
    - Create automatic daily launch tasks and reboots
    - Disable updates, prompts, notifications, UI elements
    - See [./packages/scaffold/README.md](./packages/scaffold/README.md) for more info
</details>

## Getting Started

- Create a `launchpad.json` config file. See [#Configuration](#Configuration)
- Install Launchpad as a global or local dependency:
  - Global: `npm i -g @bluecadet/launchpad` (or `npm i -g bluecadet/launchpad` from GitHub)
  - Local: `npm i @bluecadet/launchpad` (or `npm i bluecadet/launchpad` from GitHub)
- Run Launchpad
  - Global: `launchpad`
  - Local: `npx launchpad`

In all the following examples, we'll use `launchpad`, but you can always replace it with `npx launchpad` for local dependencies.

### Config Loading

- By default, Launchpad looks for `launchpad.json` or `config.json` at the cwd (where you ran `launchpad ...` from)
- You can change the default path with `--config=<YOUR_FILE_PATH>` (e.g. `launchpad --config=../settings/my-config.json`)
- If no config is found, Launchpad will traverse up directories (up to 64) to find one
- All config values can be overridden via `--foo=bar` (e.g. `--logging.level=debug`)

### Startup Options

The following commands are available when running `launchpad <command>` or `npx launchpad <command>`.

- `launchpad`: Same as `launchpad start`.
- `launchpad start`: Starts launchpad by updating content and starting apps. (default)
- `launchpad stop`: Stops and kills any existing PM2 instance.
- `launchpad content`: Only download content. Parses your config as `config.content || config`.
- `launchpad monitor`: Only start apps. Parses your config as `config.monitor || config`.
- `launchpad scaffold`: Configures the current PC for exhibit environments (with admin prompt).

Type `launchpad --help` for more info.

## Detailed Documentation

Each package has more detailed documentation.

[Core](./documentation/core.md)
[Monitor](./documentation/monitor.md)
[Content](./documentation/content.md)
[Dashboard](./documentation/dashboard.md)
[Scaffold](./documentation/scaffold.md)
[Utils](./documentation/utils.md)

## Examples:
[Simple JSON source](./examples/source-json)






<hr>
========== CUT! ==========
<hr>



























Each module has sensible defaults and is optional, so you could only define content settings if you only want to download content, or only define monitor settings if you only want to launch and monitor apps.

See the following classes for a full list of all available options:

- [`LaunchpadOptions`](./packages/core/lib/launchpad-options.js): All options for launchpad combined into a single object
  - `monitor` ([`MonitorOptions`](./packages/monitor/lib/monitor-options.js)): Configures which apps to run
  - `content` ([`ContentOptions`](./packages/content/lib/content-options.js)): Configures which content to download
    - `sources`: An array containing any amount of the following content source options:
      - [`AirtableOptions`](./packages/content/lib/content-sources/airtable-source.js): Download content from Airtable
      - [`ContentfulOptions`](./packages/content/lib/content-sources/contentful-source.js): Download content from Contentful
      - [`JsonOptions`](./packages/content/lib/content-sources/json-source.js): Download content from JSON endpoints
      - [`StrapiOptions`](./packages/content/lib/content-sources/strapi-source.js): Download content from Strapi
  - `logging` ([`LogOptions`](./packages/utils/lib/log-manager.js)): Configures how logs are routed to the console and to files


### Content Credentials

Some content sources require credentials to access their APIs.

These can all be stored in a local `.credentials.json` file which maps content-source IDs to their credentials.

Below is an example for Airtable, Contentful, Sanity and Strapi sources:

```json
{
  "exampleAirtableSource": {
    "apiKey": "<YOUR_AIRTABLE_API_KEY>"
  },
  "exampleContentfulSource": {
    "previewToken": "<YOUR_CONTENTFUL_PREVIEW_TOKEN>",
    "deliveryToken": "<YOUR_CONTENTFUL_DELIVERY_TOKEN>",
    "usePreviewApi": false
  },
  "exampleStrapiSource": {
    "identifier": "<YOUR_API_USER>",
    "password": "<YOUR_API_PASS>"
  },
  "exampleSanitySource": {
    "apiToken": "<YOUR_API_TOKEN>"
  }
}
```


### Credit
Most scripts and settings are based on examples and precedents from various existing resources. Besides StackOverflow, the following two repositories have been crucial references:
- https://github.com/jayharris/dotfiles-windows
- https://github.com/morphogencc/ofxWindowsSetup/tree/master/scripts

## Packages

This repo is a monorepo that includes the following packages:

* [`@bluecadet/launchpad-core`](packages/core)
* [`@bluecadet/launchpad-content`](packages/content)
* [`@bluecadet/launchpad-dashboard`](packages/dashboard)
* [`@bluecadet/launchpad-monitor`](packages/monitor)
* [`@bluecadet/launchpad-scaffold`](packages/scaffold)
* [`@bluecadet/launchpad-utils`](packages/utils)

Each of these packages can be launched independently (except for utils), so if you only need app-monitoring or content updates, you can install only `@bluecadet/launchpad-monitor` or `@bluecadet/launchpad-content`.

## Requirements

Launchpad requires Node 16+, but Node 17.5.0+ is recommended for better Windows API integration and workspaces support.

We recommend installing Node via [nvm-windows](https://github.com/coreybutler/nvm-windows):

```
nvm install 17.5.0
nvm use 17.5.0
```

If you run into issues installing subpackages, try upgrading `npm` to version `8.5.1` or above.

```
npm i -g npm@8.5.1
```

## Roadmap

Please refer to the [repo](https://github.com/bluecadet/launchpad/issues) to issues.
