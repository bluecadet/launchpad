# Airtable Content Source

The `airtableSource` content source is used to fetch data from Airtable. It supports fetching data from specified tables and views, and can transform the data into a simplified format.

## Usage

To use the `airtableSource` content source, include it in the list of content sources in your configuration:

```typescript{1,6-12}
import { airtableSource } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    sources: [
      airtableSource({
        id: 'myAirtableSource',
        baseId: 'appXXXXXXXXXXXXXX',
        apiKey: 'keyXXXXXXXXXXXXXX',
        tables: ['Table1', 'Table2'],
        keyValueTables: ['Settings']
      })
    ]
  }  
});
```

## Options

### `id`

- **Type:** `string`
- **Required**

Specifies the unique identifier for this source. This will be used as the download path.

### `baseId`

- **Type:** `string`
- **Required**

Specifies the Airtable base ID. See [Airtable documentation](https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base) for more details on how to obtain this ID.

### `defaultView`

- **Type:** `string`
- **Default:** `'Grid view'`

Specifies the table view to select for syncing by default.

### `tables`

- **Type:** `string[]`
- **Default:** `[]`

Specifies the tables you want to fetch from.

### `keyValueTables`

- **Type:** `string[]`
- **Default:** `[]`

As a convenience feature, you can store tables listed here as key/value pairs. Field names should be `key` and `value`.

### `endpointUrl`

- **Type:** `string`
- **Default:** `'https://api.airtable.com'`

Specifies the API endpoint to use for Airtable.

### `appendLocalAttachmentPaths`

- **Type:** `boolean`
- **Default:** `true`

Appends the local path of attachments to the saved JSON.

### `apiKey`

- **Type:** `string`
- **Required**

Specifies the Airtable API Key.
