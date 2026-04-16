# JSON Content Source

The `jsonSource` content source is used to fetch data from JSON endpoints via HTTP(S). It supports fetching multiple JSON files from different URLs and saving them with custom identifiers.

## Usage

To use the `jsonSource` content source, include it in the list of content sources in your configuration:

```typescript{1,7-14}
import { jsonSource } from '@bluecadet/launchpad/content/sources/json';

export default defineConfig({
  plugins: [
    content({
      sources: [
        jsonSource({
          id: 'myJsonSource',
          files: {
            'data1': 'https://api.example.com/data1.json',
            'data2': 'https://api.example.com/data2.json'
          },
          maxTimeout: 60000
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

Specifies the unique identifier for this source. This will be used as the download path.

### `files`

- **Type:** `Record<string, string>`
- **Required**

A mapping of JSON keys to URLs. Each key will be used as the identifier for the downloaded JSON file, while the corresponding URL specifies where to fetch the JSON data from.

For example:

```typescript
{
  'settings': 'https://api.example.com/settings.json',
  'users': 'https://api.example.com/users.json'
}
```

This will create files named `settings.json` and `users.json` in the output directory.

### `maxTimeout`

- **Type:** `number`
- **Default:** `30000`

Specifies the maximum time (in milliseconds) to wait for a response from each JSON endpoint before timing out. The default is 30 seconds.
