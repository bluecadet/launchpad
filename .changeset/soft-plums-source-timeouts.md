---
"@bluecadet/launchpad-content": patch
---

Add a configurable `maxTimeout` option (default 60s) to the Airtable, Contentful, and Sanity sources, wired into each SDK's native request timeout (`requestTimeout`, `timeout`, `timeout` respectively). Previously these sources built their SDK clients with no timeout, so a stalled connection could hang an unattended scheduled fetch indefinitely.
