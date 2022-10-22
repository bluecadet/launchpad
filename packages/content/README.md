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


## ContentOptions Parameters
Options for all content and media downloads.
| Property | Type | Description |
| - | - | - |
| <a name="module_launchpad-content/content-options.ContentOptions+credentialsPath">`credentialsPath`</a> |  <code>string</code>| The path to the json containing credentials for all content sources.<br>Defaults to &#x27;.credentials.json&#x27; |
| <a name="module_launchpad-content/content-options.ContentOptions+downloadPath">`downloadPath`</a> |  <code>string</code>| The path at which to store all downloaded files. Defaults to &#x27;.downloads/&#x27; |
| <a name="module_launchpad-content/content-options.ContentOptions+tempPath">`tempPath`</a> |  <code>boolean</code>| Temp file directory path. Defaults to &#x60;${Constants.DOWNLOAD_PATH_TOKEN}/.tmp/&#x60; |
| <a name="module_launchpad-content/content-options.ContentOptions+backupPath">`backupPath`</a> |  <code>boolean</code>| Temp directory path where all downloaded content will be backed up before removal. Defaults to &#x60;${Constants.DOWNLOAD_PATH_TOKEN}/.tmp-backup/&#x60; |
| <a name="module_launchpad-content/content-options.ContentOptions+backupAndRestore">`backupAndRestore`</a> |  <code>boolean</code>| Back up files before downloading and restore originals for all sources on failure of any single source. |
| <a name="module_launchpad-content/content-options.ContentOptions+maxConcurrent">`maxConcurrent`</a> |  <code>number</code>| Max concurrent downloads. |
| <a name="module_launchpad-content/content-options.ContentOptions+maxTimeout">`maxTimeout`</a> |  <code>number</code>| Max request timeout in ms. |
| <a name="module_launchpad-content/content-options.ContentOptions+clearOldFilesOnSuccess">`clearOldFilesOnSuccess`</a> |  <code>boolean</code>| Remove all existing files in dest dir when downloads succeed. Ignores files that match &#x60;keep&#x60; |
| <a name="module_launchpad-content/content-options.ContentOptions+clearOldFilesOnStart">`clearOldFilesOnStart`</a> |  <code>boolean</code>| Will remove all existing files _before_ downloads starts. Defaults to false so that existing files are only deleted after a download success. |
| <a name="module_launchpad-content/content-options.ContentOptions+keep">`keep`</a> |  <code>boolean</code>| Which files to keep in &#x60;dest&#x60; if &#x60;clearOldFilesOnSuccess&#x60; or &#x60;clearOldFilesOnStart&#x60; are &#x60;true&#x60;. E.g. &#x27;*.json|*.csv|*.xml|*.git*&#x27; |
| <a name="module_launchpad-content/content-options.ContentOptions+strip">`strip`</a> |  <code>string</code>| Strips this string from all media file paths when saving them locally |
| <a name="module_launchpad-content/content-options.ContentOptions+ignoreCache">`ignoreCache`</a> |  <code>boolean</code>| Will always download files regardless of whether they&#x27;ve been cached |
| <a name="module_launchpad-content/content-options.ContentOptions+enableIfModifiedSinceCheck">`enableIfModifiedSinceCheck`</a> |  <code>boolean</code>| Enables the HTTP if-modified-since check. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true. |
| <a name="module_launchpad-content/content-options.ContentOptions+enableContentLengthCheck">`enableContentLengthCheck`</a> |  <code>boolean</code>| Compares the HTTP header content-length with the local file size. Disabling this will assume that the local file is the same as the remote file if it already exists. Defaults to true. |
| <a name="module_launchpad-content/content-options.ContentOptions+abortOnError">`abortOnError`</a> |  <code>boolean</code>| If set to true, errors will cause syncing to abort all remaining tasks immediately |
| <a name="module_launchpad-content/content-options.ContentOptions+ignoreImageTransformCache">`ignoreImageTransformCache`</a> |  <code>boolean</code>| Set to true to always re-generate transformed images, even if cached versions of the original and transformed image already exist. Off by default. |
| <a name="module_launchpad-content/content-options.ContentOptions+ignoreImageTransformErrors">`ignoreImageTransformErrors`</a> |  <code>boolean</code>| Set to false if you want to abort a content source from downloading if any of the image transforms fail. Leaving this to true will allow for non-image files to fail quietly. |
| <a name="module_launchpad-content/content-options.ContentOptions+forceClearTempFiles">`forceClearTempFiles`</a> |  <code>boolean</code>| Set to false if you want to keep all contents of the tempPath dir before downloading |
| <a name="module_launchpad-content/content-options.ContentOptions+sources">`sources`</a> |  <code>Array.&lt;SourceOptions&gt;</code>| A list of content source options |
| <a name="module_launchpad-content/content-options.ContentOptions+imageTransforms">`imageTransforms`</a> |  <code>Array.&lt;Object.&lt;string, number&gt;&gt;</code>| A list of image transforms to apply to a copy of each downloaded image |
| <a name="module_launchpad-content/content-options.ContentOptions+contentTransforms">`contentTransforms`</a> |  <code>Object.&lt;string, string&gt;</code>| A list of content transforms to apply to all donwloaded content |

