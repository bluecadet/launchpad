---
"@bluecadet/launchpad-controller": patch
---

Fix IPC serialization crashing on payloads devalue can't stringify ("Cannot stringify arbitrary non-POJOs"). Event and state payloads can carry class instances like airtable's `AirtableError` (which doesn't extend `Error`), functions, or promises. `IPCSerializer.serialize` now sanitizes the payload and retries on failure — error-likes become real Errors, class instances become plain objects — and can never throw.
