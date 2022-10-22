# Launchpad Content

The [`content`](/packages/content) package downloads and locally caches content from various common web APIs.

To download content, all you need to do is define content sources and provide credentials as needed.

The following `launchpad.json` would download jsons and images from the Flickr API to `.downloads/flickr-images` (a combination of the default `.downloads/` directory and the `id` field of the content source):

```json
{
  "content": {
    "sources": [
      {
        "id": "flickr-images",
        "type": "json",
        "files": {
            "spaceships.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=spaceship",
            "rockets.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=rocket"
        }
      }
    ]
  }
}
```

See [Options API](#options-api) for a full list of content settings.

## Source Settings

Every source needs:

- `id`: ID of the individual source (required)
- `type`: Source type (default: `json`)
- Additional source-specific settings

Currently supported sources are:

- [`json`](docs/json.md) (via HTTP)
- [`airtable`](docs/airtable.md)
- [`contentful`](docs/contentful.md)
- [`sanity`](docs/sanity.md)
- [`strapi`](docs/strapi.md)

## Authentication

Some content sources require credentials to access their APIs.

These can all be stored in a local `.credentials.json` file which maps content-source IDs to their credentials. For example:

### `.credentials.json`

```json
{
  "airtable-cms": {
    "apiKey": "<YOUR_AIRTABLE_API_KEY>"
  },
  "contentful-cms": {
    "previewToken": "<YOUR_CONTENTFUL_PREVIEW_TOKEN>",
    "deliveryToken": "<YOUR_CONTENTFUL_DELIVERY_TOKEN>",
    "usePreviewApi": false
  },
  "sanity-cms": {
    "apiToken": "<YOUR_API_TOKEN>"
  },
  "strapi-cms": {
    "identifier": "<YOUR_API_USER>",
    "password": "<YOUR_API_PASS>"
  }
}
```

### `launchpad.json`

```json
{
  "content": {
    "sources": [{
      "id": "airtable-cms",
      "type": "airtable",
      //...
    }, {
      "id": "contentful-cms",
      "type": "contentful",
      //...
    }, {
      "id": "sanity-cms",
      "type": "sanity",
      //...
    }, {
      "id": "strapi-cms",
      "type": "strapi",
      //...
    }]
  }
}
```

## Post Processing

Once content is downloaded it can be processed to transform text and images. For example, launchpad can convert markdown to html and create scaled derivatives of each image.

- [Content Transforms Documetation](docs/content-transforms.md)
- [Image Transforms Documetation](docs/image-transforms.md)

## Options API

* [.ContentOptions](#module_launchpad-content/content-options.ContentOptions)
    * [`.credentialsPath`](#module_launchpad-content/content-options.ContentOptions+credentialsPath) : <code>string</code>
    * [`.downloadPath`](#module_launchpad-content/content-options.ContentOptions+downloadPath) : <code>string</code>
    * [`.tempPath`](#module_launchpad-content/content-options.ContentOptions+tempPath) : <code>boolean</code>
    * [`.backupPath`](#module_launchpad-content/content-options.ContentOptions+backupPath) : <code>boolean</code>
    * [`.backupAndRestore`](#module_launchpad-content/content-options.ContentOptions+backupAndRestore) : <code>boolean</code>
    * [`.maxConcurrent`](#module_launchpad-content/content-options.ContentOptions+maxConcurrent) : <code>number</code>
    * [`.maxTimeout`](#module_launchpad-content/content-options.ContentOptions+maxTimeout) : <code>number</code>
    * [`.clearOldFilesOnSuccess`](#module_launchpad-content/content-options.ContentOptions+clearOldFilesOnSuccess) : <code>boolean</code>
    * [`.clearOldFilesOnStart`](#module_launchpad-content/content-options.ContentOptions+clearOldFilesOnStart) : <code>boolean</code>
    * [`.keep`](#module_launchpad-content/content-options.ContentOptions+keep) : <code>boolean</code>
    * [`.strip`](#module_launchpad-content/content-options.ContentOptions+strip) : <code>string</code>
    * [`.ignoreCache`](#module_launchpad-content/content-options.ContentOptions+ignoreCache) : <code>boolean</code>
    * [`.enableIfModifiedSinceCheck`](#module_launchpad-content/content-options.ContentOptions+enableIfModifiedSinceCheck) : <code>boolean</code>
    * [`.enableContentLengthCheck`](#module_launchpad-content/content-options.ContentOptions+enableContentLengthCheck) : <code>boolean</code>
    * [`.abortOnError`](#module_launchpad-content/content-options.ContentOptions+abortOnError) : <code>boolean</code>
    * [`.ignoreImageTransformCache`](#module_launchpad-content/content-options.ContentOptions+ignoreImageTransformCache) : <code>boolean</code>
    * [`.ignoreImageTransformErrors`](#module_launchpad-content/content-options.ContentOptions+ignoreImageTransformErrors) : <code>boolean</code>
    * [`.forceClearTempFiles`](#module_launchpad-content/content-options.ContentOptions+forceClearTempFiles) : <code>boolean</code>
    * [`.sources`](#module_launchpad-content/content-options.ContentOptions+sources) : <code>Array.&lt;SourceOptions&gt;</code>
    * [`.imageTransforms`](#module_launchpad-content/content-options.ContentOptions+imageTransforms) : <code>Array.&lt;Object.&lt;string, number&gt;&gt;</code>
    * [`.contentTransforms`](#module_launchpad-content/content-options.ContentOptions+contentTransforms) : <code>Object.&lt;string, string&gt;</code>


* * *

<a name="module_launchpad-content/content-options.ContentOptions+credentialsPath"></a>

### `contentOptions.credentialsPath` : <code>string</code>
The path to the json containing credentials for all content sources.Defaults to '.credentials.json'

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+downloadPath"></a>

### `contentOptions.downloadPath` : <code>string</code>
The path at which to store all downloaded files. Defaults to '.downloads/'

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+tempPath"></a>

### `contentOptions.tempPath` : <code>boolean</code>
Temp file directory path. Defaults to `${Constants.DOWNLOAD_PATH_TOKEN}/.tmp/`

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+backupPath"></a>

### `contentOptions.backupPath` : <code>boolean</code>
Temp directory path where all downloaded content will be backed up before removal. Defaults to `${Constants.DOWNLOAD_PATH_TOKEN}/.tmp-backup/`

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+backupAndRestore"></a>

### `contentOptions.backupAndRestore` : <code>boolean</code>
Back up files before downloading and restore originals for all sources on failure of any single source.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+maxConcurrent"></a>

### `contentOptions.maxConcurrent` : <code>number</code>
Max concurrent downloads.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+maxTimeout"></a>

### `contentOptions.maxTimeout` : <code>number</code>
Max request timeout in ms.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+clearOldFilesOnSuccess"></a>

### `contentOptions.clearOldFilesOnSuccess` : <code>boolean</code>
Remove all existing files in dest dir when downloads succeed. Ignores files that match `keep`

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+clearOldFilesOnStart"></a>

### `contentOptions.clearOldFilesOnStart` : <code>boolean</code>
Will remove all existing files _before_ downloads starts. Defaults to false so that existing files are only deleted after a download success.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+keep"></a>

### `contentOptions.keep` : <code>boolean</code>
Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. '*.json|*.csv|*.xml|*.git*'

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+strip"></a>

### `contentOptions.strip` : <code>string</code>
Strips this string from all media file paths when saving them locally

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+ignoreCache"></a>

### `contentOptions.ignoreCache` : <code>boolean</code>
Will always download files regardless of whether they've been cached

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+enableIfModifiedSinceCheck"></a>

### `contentOptions.enableIfModifiedSinceCheck` : <code>boolean</code>
Enables the HTTP if-modified-since check. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+enableContentLengthCheck"></a>

### `contentOptions.enableContentLengthCheck` : <code>boolean</code>
Compares the HTTP header content-length with the local file size. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+abortOnError"></a>

### `contentOptions.abortOnError` : <code>boolean</code>
If set to true, errors will cause syncing to abort all remaining tasks immediately

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+ignoreImageTransformCache"></a>

### `contentOptions.ignoreImageTransformCache` : <code>boolean</code>
Set to true to always re-generate transformed images, even if cached versions of the original and transformed image already exist. Off by default.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+ignoreImageTransformErrors"></a>

### `contentOptions.ignoreImageTransformErrors` : <code>boolean</code>
Set to false if you want to abort a content source from downloading if any of the image transforms fail. Leaving this to true will allow for non-image files to fail quietly.

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+forceClearTempFiles"></a>

### `contentOptions.forceClearTempFiles` : <code>boolean</code>
Set to false if you want to keep all contents of the tempPath dir before downloading

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+sources"></a>

### `contentOptions.sources` : <code>Array.&lt;SourceOptions&gt;</code>
A list of content source options

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+imageTransforms"></a>

### `contentOptions.imageTransforms` : <code>Array.&lt;Object.&lt;string, number&gt;&gt;</code>
A list of image transforms to apply to a copy of each downloaded image

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

<a name="module_launchpad-content/content-options.ContentOptions+contentTransforms"></a>

### `contentOptions.contentTransforms` : <code>Object.&lt;string, string&gt;</code>
A list of content transforms to apply to all donwloaded content

**Kind**: instance property of [<code>ContentOptions</code>](#module_launchpad-content/content-options.ContentOptions)  

* * *

