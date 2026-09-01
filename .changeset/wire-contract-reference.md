---
"@bluecadet/launchpad-docs": patch
---

Add a versioned wire contract reference page for the HTTP/SSE transport (`docs/reference/controller/wire-contract.md`), specifying every request/response shape, status code, SSE frame, and the sequence-number/`_version` recovery rules a non-TypeScript client (Unity/C#, vendor tooling) needs to implement a working client without reading launchpad source. Calls out that the pushed `patches` array is Immer's patch format (array `path`, not RFC 6902 JSON Patch) and that a command resolving with `undefined` is normalized to `"result": null` on the wire, with `result` guaranteed present on every successful response.

`transports.md` is trimmed to operator-facing config — options, defaults, and security posture pointers — and now links into the wire contract for the protocol detail it used to carry.
