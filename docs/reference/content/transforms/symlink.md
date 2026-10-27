# symlink content transform

The `symlink` transform creates a symbolic link to a file or directory.

## Usage

```typescript
import { symlink } from '@bluecadet/launchpad/content/transforms/symlink'; // [!code highlight]

export default defineConfig({
  plugins: [
    content({
      transforms: [
        symlink({ // [!code highlight:5]
          target: 'path/to/target/file-or-directory',
          path: 'path/to/symlink/file-or-directory',
          condition: () => fs.existsSync('path/to/target') // Ex: only create symlink if target exists
        })
      ]
    })
  ]
});
```

## Options

### `target`

- **Type:** `string`
- **Required**

File or directory the symlink points to. Accepts an absolute path or a path relative to the launchpad config directory.

### `path`

- **Type:** `string`
- **Required**

Where to create the symlink. Accepts an absolute path or a path relative to the launchpad config directory.

### `condition`

- **Type:** `boolean | (() => boolean | Promise<boolean>)`
- **Default:** `true`

The symlink is created only when this is true. Pass a boolean, or a function that returns a boolean or a promise of one; for example, check that the target exists.
