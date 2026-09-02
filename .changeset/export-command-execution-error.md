---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-docs": patch
---

`CommandExecutionError` is now exported from `@bluecadet/launchpad-controller`'s `.` entry. It already implemented `CommandDispatchError` from `@bluecadet/launchpad-utils/plugin-interfaces` and carried the `reason` discriminant every transport maps to its own vocabulary, but nothing outside the controller package could import the concrete class — only the interface it satisfies.

Anything that needs to construct or type-narrow a dispatch failure — a transport, a test harness, a client mocking `ctx.dispatchCommand` — had no way to reach for the real thing, so it either typed against the bare `CommandDispatchError` interface or, worse, reimplemented the class from scratch. The client SDK's integration test did exactly that: it declared a `DispatchFailure` stand-in class implementing `CommandDispatchError` solely so its mock dispatcher could hand back something with the right shape. That duplicate is now gone; the test imports `CommandExecutionError` directly and constructs it with the same `{ reason, commandType, cause }` options object the real dispatcher uses.

This is a narrow visibility fix, not a new capability. `CommandExecutionError`'s behavior, constructor, and the `CommandFailureReason` values it accepts (`not-registered`, `invalid`, `handler-failed`) are unchanged — this only adds a re-export so code that already depended on the controller package can name the class instead of reconstructing it.

Plugin authors still don't need this export and shouldn't reach for it. A plugin returns a plain `Error` from `errAsync()`; the dispatcher is what wraps that into a `CommandExecutionError` with `reason: "handler-failed"` before it reaches a transport or client, and that wrapping happens in `command-dispatcher.ts` regardless of what error type the plugin threw. No plugin package depends on the controller, and no plugin constructs a `reason`-carrying error itself, so this change adds no new import plugin authors are expected to take. The export exists for the other side of the boundary: transports, test utilities, and clients that consume a dispatch failure and want to talk about it as the concrete type it actually is, rather than duplicating its shape by hand.

The docs bump covers a short addition to the custom-plugin recipe and the controller reference page clarifying this wrapping behavior and where to read about `reason` on the wire.
