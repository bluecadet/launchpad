---
"@bluecadet/launchpad-content": minor
---

Emit `content:source:error` event when an individual content source fails during a fetch.

Previously, source errors were only surfaced through the fetch result. Now a `content:source:error` event is emitted on the event bus with `{ sourceId, error }`, allowing subscribers to react to partial failures without waiting for the entire fetch to complete.
