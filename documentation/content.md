# Content

The Content Package can download and locally cache content from various common web APIs.

## Content Sources

LaunchPad Content currently supports these sources:

- [JSON with asset urls](content/json.md)
- [Airtable API](content/airtable.md)
- [Contentful API](content/contentful.md)
- [Strapi API (3.x.x)](content/strapi.md)
- [Sanity](content/sanity.md)

## Content - Global Settings

[Image Transformations](content/image-transformations.md)

```json
  "credentialsPath": "./credentials.json",
  "downloadPath": "./data/",
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
  "limit": 2,
  "maxNumPages": -1,
  "combinePaginatedFiles": true,
```

## Content - Source Settings

Every source needs:

- id: ID of the individual Source (required)
- type: Source Type

## Credentials

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
## How to contribute to Launchpad Core
