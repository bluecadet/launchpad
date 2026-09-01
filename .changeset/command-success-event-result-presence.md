---
"@bluecadet/launchpad-controller": major
---

A command whose handler resolves with nothing now carries a present, `null` `result` on the `command:success` event, instead of the `result` key silently vanishing under JSON serialization. `content.ack`, `content.fetch`, `content.clear`, and every `monitor.*` command resolve nothing, so every one of them previously emitted `command:success` with no `result` key at all to any SSE subscriber whose `events` filter included it (`*`, or `command:*`). The dispatcher now normalizes an `undefined` result to `null` at the point it emits the event, matching the normalization already applied on the HTTP and IPC command-response paths, so `result` is guaranteed present on `command:success` regardless of which surface a client is watching.

One consequence: an SSE consumer that previously distinguished "no result key" from "null result" on `command:success` will now see `null` for both. That collapse is accepted for the same reason it was accepted on the request/response paths — a command that needs its own explicit "no result" signal should encode it in its own result shape rather than rely on `null` versus a missing key.
