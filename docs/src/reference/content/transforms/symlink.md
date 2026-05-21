# symlink Content Transform

The `symlink` transform is used to create symbolic links between files or directories.

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

Specifies the target file or directory that the symlink will point to, which can be a relative or absolute path.

Relative paths are resolved against the launchpad config directory.

### `path`

- **Type:** `string`
- **Required**

Specifies the path where the symlink will be created.

Relative paths are resolved against the launchpad config directory.

### `condition`

- **Type:** `boolean | (() => boolean | Promise<boolean>)`
- **Default:** `true`

Specifies a condition that must be met for the symlink to be created. This can be a boolean value or a function that returns a boolean or a promise that resolves to a boolean.

If the condition is not met, the symlink will not be created. This is useful for scenarios where you want to conditionally create symlinks based on the existence of files or directories.
