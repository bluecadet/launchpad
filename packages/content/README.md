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

See [ContentOptions Parameters](#contentoptions-parameters) for a full list of content settings.

## Source Settings

Every source needs:

- `id`: ID of the individual source (required)
- `type`: Source type (default: `json`)
- Additional source-specific settings

Currently supported sources are:

- [`json`](docs/json-source.md) (via HTTP)
- [`airtable`](docs/airtable-source.md)
- [`contentful`](docs/contentful-source.md)
- [`sanity`](docs/sanity-source.md)
- [`strapi`](docs/strapi-source.md)

## Authentication

Some content sources require credentials to access their APIs.

These can all be stored in a `.env` or `.env.local` file which will be automatically loaded by launchpad.

### `.env.local`

```sh
AIRTABLE_API_KEY=<YOUR_AIRTABLE_API_KEY>

CONTENTFUL_PREVIEW_TOKEN=<YOUR_CONTENTFUL_PREVIEW_TOKEN>
CONTENTFUL_DELIVERY_TOKEN=<YOUR_CONTENTFUL_DELIVERY_TOKEN>
CONTENTFUL_USE_PREVIEW_API=false

SANITY_API_TOKEN=<YOUR_API_TOKEN>

STRAPI_IDENTIFIER=<YOUR_API_USER>
STRAPI_PASSWORD=<YOUR_API_PASS>
```

### `launchpad.config.js`

```js
export default defineConfig({
	content: {
		sources: [
			{
				id: "airtable-cms",
				type: "airtable",
				apiKey: process.env.AIRTABLE_API_KEY,
			},
			{
				id: "contentful-cms",
				type: "contentful",
				previewToken: process.env.CONTENTFUL_PREVIEW_TOKEN,
				deliveryToken: process.env.CONTENTFUL_DELIVERY_TOKEN,
				usePreviewApi: false,
			},
			{
				id: "sanity-cms",
				type: "sanity",
				apiToken: process.env.SANITY_API_TOKEN,
			},
			{
				id: "strapi-cms",
				type: "strapi",
				identifier: process.env.STRAPI_IDENTIFIER,
			},
		],
	},
});

```

## Post Processing

Once content is downloaded it can be processed to transform text and images. For example, launchpad can convert markdown to html and create scaled derivatives of each image.

- [Content Transforms Documetation](docs/content-transforms.md)
- [Image Transforms Documetation](docs/image-transforms.md)


##  ContentOptions
Options for all content and media downloads. Each of these settings can also be configured per `ContentSource`.


| Property | Type | Default | Description |
| - | - | - | - |
| <a name="module_launchpad-content/content-options.ContentOptions+sources">`sources`</a> |  <code>Array.&lt;SourceOptions&gt;</code>|  <code>[]</code>  | A list of content source options. This defines which content is downloaded from where. |
| <a name="module_launchpad-content/content-options.ContentOptions+imageTransforms">`imageTransforms`</a> |  <code>Array.&lt;Object.&lt;string, number&gt;&gt;</code>|  <code>[]</code>  | A list of image transforms to apply to a copy of each downloaded image. |
| <a name="module_launchpad-content/content-options.ContentOptions+contentTransforms">`contentTransforms`</a> |  <code>Object.&lt;string, string&gt;</code>|  <code>{}</code>  | A list of content transforms to apply to all donwloaded content. |
| <a name="module_launchpad-content/content-options.ContentOptions+downloadPath">`downloadPath`</a> |  <code>string</code>|  <code>'.downloads/'</code>  | The path at which to store all downloaded files. |
| <a name="module_launchpad-content/content-options.ContentOptions+credentialsPath">`credentialsPath`</a> |  <code>string</code>|  <code>'.credentials.json'</code>  | The path to the json containing credentials for all content sources. |
| <a name="module_launchpad-content/content-options.ContentOptions+tempPath">`tempPath`</a> |  <code>boolean</code>|  <code>'%DOWNLOAD\_PATH%/.tmp/'</code>  | Temp file directory path. |
| <a name="module_launchpad-content/content-options.ContentOptions+backupPath">`backupPath`</a> |  <code>boolean</code>|  <code>'%DOWNLOAD\_PATH%/.backups/'</code>  | Temp directory path where all downloaded content will be backed up before removal. |
| <a name="module_launchpad-content/content-options.ContentOptions+keep">`keep`</a> |  <code>boolean</code>|  <code>''</code>  | Which files to keep in `dest` if `clearOldFilesOnSuccess` or `clearOldFilesOnStart` are `true`. E.g. `'\*.json\|\*.csv\|\*.xml\|\*.git\*'` |
| <a name="module_launchpad-content/content-options.ContentOptions+strip">`strip`</a> |  <code>string</code>|  <code>''</code>  | Strips this string from all media file paths when saving them locally |
| <a name="module_launchpad-content/content-options.ContentOptions+backupAndRestore">`backupAndRestore`</a> |  <code>boolean</code>|  <code>true</code>  | Back up files before downloading and restore originals for all sources on failure of any single source. |
| <a name="module_launchpad-content/content-options.ContentOptions+maxConcurrent">`maxConcurrent`</a> |  <code>number</code>|  <code>4</code>  | Max concurrent downloads. |
| <a name="module_launchpad-content/content-options.ContentOptions+maxTimeout">`maxTimeout`</a> |  <code>number</code>|  <code>30000</code>  | Max request timeout in ms. |
| <a name="module_launchpad-content/content-options.ContentOptions+clearOldFilesOnSuccess">`clearOldFilesOnSuccess`</a> |  <code>boolean</code>|  <code>true</code>  | Remove all existing files in dest dir when downloads succeed. Ignores files that match `keep` |
| <a name="module_launchpad-content/content-options.ContentOptions+clearOldFilesOnStart">`clearOldFilesOnStart`</a> |  <code>boolean</code>|  <code>false</code>  | Will remove all existing files \_before\_ downloads starts. `false` will ensure that existing files are only deleted after a download succeeds. |
| <a name="module_launchpad-content/content-options.ContentOptions+ignoreCache">`ignoreCache`</a> |  <code>boolean</code>|  <code>false</code>  | Will always download files regardless of whether they've been cached |
| <a name="module_launchpad-content/content-options.ContentOptions+enableIfModifiedSinceCheck">`enableIfModifiedSinceCheck`</a> |  <code>boolean</code>|  <code>true</code>  | Enables the HTTP if-modified-since check. Disabling this will assume that the local file is the same as the remote file if it already exists. |
| <a name="module_launchpad-content/content-options.ContentOptions+enableContentLengthCheck">`enableContentLengthCheck`</a> |  <code>boolean</code>|  <code>true</code>  | Compares the HTTP header content-length with the local file size. Disabling this will assume that the local file is the same as the remote file if it already exists. |
| <a name="module_launchpad-content/content-options.ContentOptions+abortOnError">`abortOnError`</a> |  <code>boolean</code>|  <code>true</code>  | If set to `true`, errors will cause syncing to abort all remaining tasks immediately |
| <a name="module_launchpad-content/content-options.ContentOptions+ignoreImageTransformCache">`ignoreImageTransformCache`</a> |  <code>boolean</code>|  <code>false</code>  | Set to `true` to always re-generate transformed images, even if cached versions of the original and transformed image already exist. |
| <a name="module_launchpad-content/content-options.ContentOptions+ignoreImageTransformErrors">`ignoreImageTransformErrors`</a> |  <code>boolean</code>|  <code>true</code>  | Set to `false` if you want to abort a content source from downloading if any of the image transforms fail. Leaving this to `true` will allow for non-image files to fail quietly. |
| <a name="module_launchpad-content/content-options.ContentOptions+forceClearTempFiles">`forceClearTempFiles`</a> |  <code>boolean</code>|  <code>true</code>  | Set to `false` if you want to keep all contents of the tempPath dir before downloading |

