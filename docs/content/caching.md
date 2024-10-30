# Caching & Updates

Launchpad implements a smart caching system to minimize unnecessary downloads and ensure reliable content updates.

## How Caching Works

The caching system operates on multiple levels:

1. **Content Caching**: Checks if remote content has changed
2. **Media Caching**: Tracks downloaded media files
3. **Transform Caching**: Caches processed images and content

## Configuration

```js
import { defineConfig } from '@bluecadet/launchpad';

export default defineConfig({
  content: {
    downloadPath: '.downloads/',
    tempPath: '.tmp/',
    backupPath: '.backups/',
    backupAndRestore: true
  }
});
```

## Cache Directories

| Directory      | Purpose                  | Default Path  |
| -------------- | ------------------------ | ------------- |
| `downloadPath` | Final content location   | `.downloads/` |
| `tempPath`     | Temporary processing     | `.tmp/`       |
| `backupPath`   | Backup of previous state | `.backups/`   |

## Backup & Restore

Launchpad maintains backups of your content:

```js
{
  content: {
    // Enable automatic backup/restore
    backupAndRestore: true,
    
    // Backup location with timestamp
    backupPath: '.backups/%TIMESTAMP%/',
    
    // Keep specific files during updates
    keep: ['*.git*', 'custom/**/*']
  }
}
```

## Error Recovery

The caching system provides automatic error recovery:

1. Content is downloaded to temp directory
2. Current content is backed up
3. New content replaces old content
4. On error, backup is restored
