# Content progress logging

`ContentProgressLogger` reports completed tasks through the content transform's event bus, with or without the artifact cache. The built-in `mediaDownloader` and Sharp transforms use it.

## Import

```typescript
import { ContentProgressLogger } from '@bluecadet/launchpad/content';
```

Projects that use `@bluecadet/launchpad-content` directly can import it from that package's root. Using it with `ctx.eventBus` needs no utility-package import.

## Constructor options

```typescript
const progress = new ContentProgressLogger({
  eventBus: ctx.eventBus,
  total: tasks.length,
  label: 'Processing documents',
  freshLabel: 'Processed',
});
```

- `eventBus: EventBus` is required. Pass the transform context's `eventBus`.
- `total: number` is required and must be a nonnegative safe integer. Use zero for an empty task list. Invalid totals throw a `RangeError`.
- `label: string` is required and must be nonempty and single-line. Omit a trailing colon; the logger adds the separator.
- `freshLabel?: string` defaults to `'Processed'` and must also be nonempty and single-line. Pass a task-specific verb such as `'Downloaded'` or `'Transformed'` to change it.

Whitespace-only labels and labels containing line breaks throw a `TypeError`.

There is no cache-mode option; one instance counts both fresh and reused results.

## Counters

The read-only getters `total`, `fresh`, and `cached` return numbers. `total` stays fixed; `fresh` and `cached` start at zero.

These are **task counts**, not bytes, file sizes, or transfer rates. You choose the unit when building the task list. For example, one `derive()` call that writes several files is one task if you call `complete()` once for it.

## `complete(result?): void`

Call `complete()` exactly once after a task succeeds:

```typescript
await performTask();
progress.complete();
```

The optional result has the shape `{ reused: boolean }`:

- `complete()` and `complete({ reused: false })` increment `fresh` by one.
- `complete({ reused: true })` increments `cached` by one.
- A completion that would make `fresh + cached` exceed `total` throws a `RangeError` without changing either counter.
- After `close()`, `complete()` is inert and does not change counters or throw for an overshoot.

Do not count a failed or cancelled task. With the artifact cache, pass the resolved result directly:

```typescript
const result = await ctx.cache.derive(artifact);
progress.complete(result);
```

Call `complete(result)` **outside** `generate`, after `derive()` resolves. A hit skips `generate`, and a miss succeeds only after its declared outputs are verified. On a hit, `derive()` finishes copying reusable files into staging before it resolves.

## `close(): void` and task lifetime

Always call `close()` in `finally`, after every started task has settled. It flushes the final progress update, stops the logger's interval, and emits `log:tty:close`. Repeated calls do nothing. Closing a partly completed logger leaves the counters unchanged and does not mark remaining tasks successful.

A sequential loop keeps cleanup ordering simple:

```typescript
import {
  ContentProgressLogger,
  type ContentTransformContext,
} from '@bluecadet/launchpad/content';

async function runTasks(
  ctx: ContentTransformContext,
  tasks: readonly (() => Promise<void>)[],
) {
  const progress = new ContentProgressLogger({
    eventBus: ctx.eventBus,
    total: tasks.length,
    label: 'Processing tasks',
  });

  try {
    for (const performTask of tasks) {
      ctx.abortSignal.throwIfAborted();
      await performTask();
      progress.complete();
    }
  } finally {
    progress.close();
  }
}
```

With concurrency, wait for every started task to settle before closing the logger or returning from `apply()`. `Promise.all()` alone is insufficient, because it can reject while other tasks are still running.

The logger's lifecycle is independent of the artifact cache. Closing the logger does not close, abort, or commit the run-owned cache; Launchpad manages the cache.

## Output events

The logger emits `log:tty` progress updates and `log:tty:close` through the event bus and never writes to the console. It emits events even when stdout is not a TTY; subscribers decide how to render them.

## Related pages

- [Add progress to a custom transform](../../recipes/custom-content-transform.md#report-progress-without-caching)
- [Cache generated files](../../recipes/custom-content-transform.md#cache-generated-files)
- [Content transform context](./transforms/index.md)
- [Artifact cache](./artifact-cache.md)
