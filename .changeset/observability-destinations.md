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

Send logs and current-state gauges to endpoints you choose, with optional resource attributes and OTLP/HTTP JSON or protobuf encoding. Generated projects keep export opt-in and endpoint-gated; legacy log transports remain supported.

Breaking public types: `LogEntry` fields are readonly, and `ObservabilityConfig` is now a union. Stop mutating entries and narrow the config variant before accessing `transports`, which isn't present in destination mode. These changes also apply through the umbrella exports.
