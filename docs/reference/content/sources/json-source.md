# JSON content source

The `jsonSource` content source fetches JSON files over HTTP(S) and saves each under an identifier you choose.

## Usage

Add it to the content `sources` list:

```typescript {1,7-14}
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

Unique identifier for this source, also used as its download directory name.

### `files`

- **Type:** `Record<string, string>`
- **Required**

Maps file identifiers to the URLs to fetch. For example:

```typescript
{
  'settings': 'https://api.example.com/settings.json',
  'users': 'https://api.example.com/users.json'
}
```

This creates `settings.json` and `users.json` in the output directory.

### `maxTimeout`

- **Type:** `number`
- **Default:** `30000`

Timeout in milliseconds for each JSON request.
