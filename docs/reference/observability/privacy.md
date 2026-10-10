---
title: "Observability Privacy and Delivery Limits"
---

Enabling observability sends data from the machine to every configured destination. Launchpad does not send telemetry to a default Bluecadet endpoint.

## Review data before enabling export

Logs can contain message arguments and event metadata supplied by your application or plugins. Structured destinations safely normalize values that JSON cannot represent directly, but normalization is not complete secret detection.

Redaction is key-based. It can cover recognized keys such as token, password, authorization, or API-key fields, including nested fields, but it cannot identify every secret. A credential placed in an ordinary field, interpolated into a message, embedded in a URL, or stored in an unrecognized key can still be exported.

Before enabling a destination:

1. Review application log calls and the event patterns in `include`.
2. Do not log credentials, personal data, access URLs, or raw request bodies.
3. Use `exclude` to suppress event families that are not appropriate for the destination.
4. Keep resource and metric-point attributes low-cardinality and non-sensitive.
5. Protect destination tokens with your deployment secret manager and TLS.
6. Verify retention, access, and regional requirements in the receiving system.

Metrics are bounded current-state gauges, but their resource and metric-point attributes can still identify a machine or deployment. The two attribute scopes are configured and exported separately. Disabling log patterns does not disable metrics; set `metrics: false` when those observations must not leave the machine.

## Delivery is best effort

Telemetry is buffered only in memory. Queues are capped, exports time out, and shutdown is allowed a finite grace period. Records can be lost when:

- a queue reaches `delivery.maxQueuedBatches`;
- the process exits or crashes before buffered data is exported;
- an export exceeds `delivery.deliveryTimeoutMs`;
- shutdown exceeds `delivery.shutdownTimeoutMs`;
- a destination permanently rejects records; or
- retries cannot complete before the applicable limit.

Use a local collector with durable storage if the deployment needs stronger guarantees. Launchpad does not provide a central server, durable spool, alerting rules, or dashboard.
