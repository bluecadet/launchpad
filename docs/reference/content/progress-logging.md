# Content Progress Logging

`ContentProgressLogger` reports completed tasks through the content transform's event bus. It works with or without the artifact cache. The built-in `mediaDownloader` and Sharp transforms use the same logger.

## Import

```typescript
import { ContentProgressLogger } from '@bluecadet/launchpad/content';
```

The class is also exported from the root of `@bluecadet/launchpad-content` for projects using that package directly. No utility-package import is needed to use it with `ctx.eventBus`.

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
- `total: number` is required and must be a nonnegative safe integer. Zero is valid for an empty task list. Invalid totals throw a `RangeError`.
- `label: string` is required and must be nonempty and single-line. Supply the label without a trailing colon; the logger adds the separator.
- `freshLabel?: string` defaults to `'Processed'` and must also be nonempty and single-line. Use a task-specific verb such as `'Downloaded'` or `'Transformed'` if needed.

Whitespace-only labels and labels containing line breaks throw a `TypeError`.

There is no cache-mode option. The same instance can count fresh and reused results.

## Counters

The read-only getters `total`, `fresh`, and `cached` return numbers. `total` stays fixed; `fresh` and `cached` start at zero.

These are **task counts**, not byte counts, file sizes, or transfer rates. You choose the unit when constructing the task list. For example, one `derive()` call producing several output files is one task if you call `complete()` once for that call.

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

Do not count a failed or cancelled task as completed. With the artifact cache, pass the resolved result directly:

```typescript
const result = await ctx.cache.derive(artifact);
progress.complete(result);
```

Keep `complete(result)` **outside** `generate` and after `derive()` resolves. A hit skips `generate`, and a miss is not successful until its declared outputs have been verified. On a hit, `derive()` also finishes copying reusable files into staging before resolving.

## `close(): void` and task lifetime

Always call `close()` in `finally`, after all tasks you've started have settled. It flushes the final progress update, stops the logger's interval, and emits `log:tty:close`. Repeated calls do nothing. Closing a partially completed logger does not mark the remaining tasks successful or alter the counters.

A sequential loop keeps cleanup ordering straightforward:

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

If you add concurrency, wait for every started task to settle before closing the logger or returning from `apply()`. A rejecting `Promise.all()` alone is insufficient: it can reject while other tasks are still running.

The progress logger's lifecycle is independent of the artifact cache's lifecycle. Closing the logger does not close, abort, or commit the run-owned cache. Launchpad manages that cache.

## Output events

The logger emits `log:tty` progress updates and `log:tty:close` through the event bus; it does not write to the console itself. Events are emitted even when stdout is not a TTY. Event subscribers decide how to render them.

## Related pages

- [Add progress to a custom transform](../../recipes/custom-content-transform.md#report-progress-without-caching)
- [Cache generated files](../../recipes/custom-content-transform.md#cache-generated-files)
- [Content transform context](./transforms/index.md)
- [Artifact cache](./artifact-cache.md)
