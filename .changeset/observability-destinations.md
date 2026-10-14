---
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-content": minor
"@bluecadet/launchpad-monitor": minor
"@bluecadet/launchpad-scheduler": minor
"@bluecadet/launchpad-observability": major
"@bluecadet/launchpad": major
"@bluecadet/create-launchpad": minor
---

Add endpoint-neutral observability destinations with optional resource attributes, periodic gauge observation hooks, selectable OTLP/HTTP JSON or protobuf encoding, umbrella exports, opt-in endpoint-only scaffolding, and setup documentation while preserving the legacy log transport API.

This is a major release of `@bluecadet/launchpad-observability` for breaking public type changes: `LogEntry` fields are now readonly, and `ObservabilityConfig` becomes a union whose destination variant has no `transports` property. Stop mutating log entries and narrow the config variant before accessing `transports`. The umbrella `@bluecadet/launchpad` also receives a major release because it exposes these breaking public type contracts.
