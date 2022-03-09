const config = {
  "logging": {
    // "level": "debug"
  },
  // Optional image transforms to apply to each image. This will create a unique copy for each transform.
  // E.g. {"scale": 2.0} would generate "image.png" and "image@2x.png". Transforms are currently performed
  // on each sync, even if images were previously cached.
  "imageTransforms": [
    {"scale": 2.0},
    {"scale": 0.5},
    {"scale": 0.25}
  ],
  // Optional content transforms to apply to all json files. The key in each transform object is the json path
  // to query for, the value is an array of transforms to apply to any matching json values.
  // @see https://github.com/dchester/jsonpath#readme for query syntax.
  // Currently only supports "mdToHtml".
  "contentTransforms": {
    "$..body": ["mdToHtml"]
  },
  // These are the actual content sources. Currently supported types are 'json', 'airtable' and 'contentful'
  // Each source can override any of the content settings above.
  "sources": [
    {
      // Required field
      "id": "spaceships",
      // Optional field. Defaults to 'json'
      "type": "json",
      // Each JsonSource can contain multiple JSON files. The key
      // is the filename to save this JSON as and the value is the URL.
      // Once downloaded, the JSON will be parsed for media files to 
      // download using the `mediaPattern` property (defaults to
      // images and videos). This only works for absolute URLs.
      "files": {
          "spaceships.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=spaceship",
          "rockets.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=rocket"
      },
      // This will be stripped from each URL before saving to dest. Defaults to ''.
      "strip": "services/feeds/",
      // You can override any of the root config values in each source
      "imageTransforms": [
        {"scale": 0.75}
      ]
    },
    {
      "id": "astronauts",
      "files": {
        "astronauts.json": "https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=astronauts"
      },
      "strip": "services/feeds/"
    },
    {
      // Currently only supports Strapi 3.x.x
      "id": "strapiTest",
      // Required field if value is other than 'json'
      "type": "strapi",
      // Only version 3 is supported currently
      "version": 3,
      // The base url of your Strapi CMS (with or without trailing slash)
      "baseUrl": "http:localhost:1337/",
       // Queries for each type of content you want to save. One per content type.
       // Content will be stored as numbered, paginated JSONs. You can include
       // all query parameters supported by Strapi: https://docs-v3.strapi.io/developer-docs/latest/developer-resources/content-api/content-api.html#api-parameters
      "queries": ["poems"],
      // Max number of entries per page
      "limit": 100,
      // Max number of pages. Default is -1 for all pages
      "maxNumPages": -1,
      // How many zeros to pad each json filename index with. Default is 0
      "pageNumZeroPad": 0,
    },
    {
      // Contentful support is WIP and the API will likely change
      "id": "contentfulTest",
      // Required field if value is other than 'json'
      "type": "contentful",
      // Your Contentful space ID. Note that credentials.json will require an accessToken in addition to this
      "space": "qc670l0h4zjf",
      // Optional. Used to pull localized images. Defaults to "en-US"
      "locale": "en-US",
      // Optional. The filename you want to use for where all content (entries and assets metadata) will be stored. Defaults to "content.json"
      "filename": "content.json",
      // Optional. Defaults to "https".
      "protocol": "https",
      // Optional. Supports anything from https://www.contentful.com/developers/docs/references/content-delivery-api/#/reference/search-parameters
      "searchParams": {
        // Optional. How many entries to request per page. Defaults to 1000 (API max).
        "limit": 1000,
        // Optional. How many levels of linked entries to include. Defaults to 10 (API max).
        "include": 10
      },
      // Optional shortcut to filter by content types. This will also include all linked assets.
      // Types that link to other types will include up to 10 levels of child content.
      // E.g. filtering by Story, might also include Chapters and Images.
      // Uses searchParams['sys.contentType.sys.id[in]'] under the hood.
      "contentTypes": [],
      // Optional. Applies to all images. Defaults to empty object.
      // IMPORTANT: If you change the parameters, you will have to delete all cached images since the modified date of the original image will not have changed.
      // @see https://www.contentful.com/developers/docs/references/images-api/#/reference/resizing-&-cropping/specify-focus-area.
      "imageParams": {
        "f": "face",
        "fit": "crop",
        "w": 512,
        "h": 512
      }
    },
    {
      // Airtable support is WIP and the API will likely change
      "id": "airtableTest",
      // Required field if value is other than 'json'
      "type": "airtable",
      // Airtable base ID. @see https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base.
      "baseId": "apppsX7HeYHO7rMjd",
      // Optional. Defaults to 'Grid view'
      "defaultView": "Grid view",
      // The tables you want to fetch from
      "tables": ["data"],
      // As a convenience feature, you can store tables listed here as key/value pairs.
      // Field names should be "key" and "value".
      "keyValueTables": ["settings"],
      // Will append a `localPath` property to each downloaded attachment entry if set to true
      "appendLocalAttachmentPaths": true,
    }
  ]
};

export default config;