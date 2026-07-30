---
"@bluecadet/launchpad-content": minor
---

Add Strapi v5 support to `strapiSource`, and make it the new default `version` ("5", up from "3"). v5 uses the same pagination and query params as v4, and its flattened entry shape (fields at the top level plus `documentId`) is passed through to saved JSON as-is.

Breaking: projects that don't set `version` explicitly previously got v3 behavior and will now get v5. Set `version: "3"` or `version: "4"` explicitly to keep the previous behavior.

Also fixes the login auth endpoint: it's now version-aware, posting to `{baseUrl}/auth/local` for v3 and `{baseUrl}/api/auth/local` for v4 and v5. Previously it always posted to `/auth/local`, which was incorrect for v4. Token-based auth is unaffected.
