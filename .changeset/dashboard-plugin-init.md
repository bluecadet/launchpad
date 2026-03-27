---
"@bluecadet/launchpad-dashboard": minor
---

Implements the `@bluecadet/launchpad-dashboard` plugin. Launches an HTTP server with a server-driven UI (h3 + htmx + SSE) that updates in real-time as plugin state changes.

Plugins contribute panels and pages via config — no runtime detection of the dashboard required. A `@bluecadet/launchpad-dashboard/ui` sub-path exports helpers (`html`, `raw`, `commandButton`, `statusBadge`, `dataTable`) for building panel content without writing client-side JavaScript.
