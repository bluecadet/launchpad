# Airtable content source

The `airtableSource` content source fetches data from specified Airtable tables and views, and can simplify the result into key/value pairs.

## Usage

Add it to the content `sources` list:

```typescript {1,7-13}
import { airtableSource } from '@bluecadet/launchpad/content/sources/airtable';

export default defineConfig({
  plugins: [
    content({
      sources: [
        airtableSource({
          id: 'myAirtableSource',
          baseId: 'appXXXXXXXXXXXXXX',
          apiKey: 'keyXXXXXXXXXXXXXX',
          tables: ['Table1', 'Table2'],
          keyValueTables: ['Settings']
        })
      ]
    })
  ]
});
```

## Options

### `id`

- **Type:** `string`
- **Required**

Unique identifier for this source, also used as its download directory name.

### `baseId`

- **Type:** `string`
- **Required**

Airtable base ID. See [this guide](https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base) for how to find it.

### `defaultView`

- **Type:** `string`
- **Default:** `'Grid view'`

Table view to sync by default.

### `tables`

- **Type:** `string[]`
- **Default:** `[]`

Tables to fetch.

### `keyValueTables`

- **Type:** `string[]`
- **Default:** `[]`

Tables to store as key/value pairs. Their fields must be named `key` and `value`.

### `endpointUrl`

- **Type:** `string`
- **Default:** `'https://api.airtable.com'`

Airtable API endpoint.

### `appendLocalAttachmentPaths`

- **Type:** `boolean`
- **Default:** `true`

Adds each attachment's local path to the saved JSON.

### `apiKey`

- **Type:** `string`
- **Required**

Airtable API key.
