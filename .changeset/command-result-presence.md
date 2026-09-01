---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad-docs": patch
---

A command whose handler resolves with nothing now serializes as `{"result": null}` on the HTTP transport, instead of `{"result": undefined}` silently dropping the `result` key. `JSON.stringify({ result: undefined })` produces `{}`, so a client that required `result` to always be present — even as `null` — would fail to deserialize a successful void command; `content.fetch`, `content.clear`, `content.ack`, and every `monitor.*` command hit this on every call, since none of them resolve a payload. The HTTP transport now normalizes a command's `undefined` result to `null` before it goes on the wire, so `result` is guaranteed present on every successful response. The IPC transport never had this bug — it serializes via `IPCSerializer`/devalue, which represents `undefined` faithfully and always includes the `result` key — but it now applies the same `null` normalization for parity with HTTP, giving up the fidelity devalue had so a client written against one transport behaves identically against the other.

One consequence of the fix: a command that legitimately resolves `null` and one that resolves `undefined` are now indistinguishable on the wire, both arriving as `"result": null`. That collapse is accepted as simpler than teaching the transport layer to preserve the difference; a command that needs its own explicit "no result" signal should encode it in its own result shape rather than rely on `null` versus a missing key.

The wire contract reference documents this as a guarantee a client can rely on, replacing the "result omission gotcha" it previously described.
