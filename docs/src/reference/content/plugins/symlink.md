# symlink Content Plugin

The `symlink` plugin is used to create symbolic links between files or directories.

## Usage

```typescript
import { symlink } from '@bluecadet/launchpad-content';

export default defineConfig({
  content: {
    // ...
    plugins: [
      symlink({
        source: 'path/to/source/file-or-directory',
        target: 'path/to/target/file-or-directory',
        condition: () => fs.existsSync('path/to/target') // Ex: only create symlink if target exists
      })
    ]
  }
});
```

## Options

### `source`

- **Type:** `string`
- **Required**

Specifies the source file or directory to create a symlink from, which can be a relative or absolute path.

Relative paths are resolved against the launchpad root.

### `target`

- **Type:** `string`
- **Required**

Specifies the target file or directory to create a symlink to.

Relative paths are resolved against the launchpad root.

### `condition`

- **Type:** `boolean | (() => boolean | Promise<boolean>)`
- **Default:** `true`

Specifies a condition that must be met for the symlink to be created. This can be a boolean value or a function that returns a boolean or a promise that resolves to a boolean.

If the condition is not met, the symlink will not be created. This is useful for scenarios where you want to conditionally create symlinks based on the existence of files or directories.