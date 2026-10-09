# OTLP protobuf compatibility fixtures

These binary fixtures were generated independently from the official
[`opentelemetry-proto` v1.9.0 definitions](https://github.com/open-telemetry/opentelemetry-proto/tree/v1.9.0/opentelemetry/proto)
at commit `a8951735f7801e8adfaec5c0ace9262771cfec6e` using `protoc 36.2`.
The checked-in `.textproto` files are the source values for the matching `.bin`
files. `wire-fixtures.ts` is a hexadecimal mirror of those binaries because the
test setup replaces `node:fs` with an in-memory filesystem; tests consume the
mirror, not bytes produced by the codec under test.

From an `opentelemetry-proto` checkout at that commit, regenerate them with:

```sh
PROTO=/path/to/opentelemetry-proto
FIXTURES=packages/observability/src/__tests__/fixtures/otlp-protobuf

protoc -I "$PROTO" \
  --encode=opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest \
  "$PROTO/opentelemetry/proto/collector/logs/v1/logs_service.proto" \
  < "$FIXTURES/logs-request.textproto" > "$FIXTURES/logs-request.bin"

protoc -I "$PROTO" \
  --encode=opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest \
  "$PROTO/opentelemetry/proto/collector/metrics/v1/metrics_service.proto" \
  < "$FIXTURES/metrics-request.textproto" > "$FIXTURES/metrics-request.bin"

for fixture in logs-response-large logs-response-negative; do
  protoc -I "$PROTO" \
    --encode=opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse \
    "$PROTO/opentelemetry/proto/collector/logs/v1/logs_service.proto" \
    < "$FIXTURES/$fixture.textproto" > "$FIXTURES/$fixture.bin"
done

protoc -I "$PROTO" \
  --encode=opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse \
  "$PROTO/opentelemetry/proto/collector/metrics/v1/metrics_service.proto" \
  < "$FIXTURES/metrics-response-large.textproto" \
  > "$FIXTURES/metrics-response-large.bin"
```

`logs-response-large-unknown.bin` is `logs-response-large.bin` followed by an
independently compiled unknown field (`uint64 future_field = 15`, value `7`). It
verifies protobuf's forward-compatible unknown-field behavior. The appended
bytes can be regenerated with:

```sh
cat >/tmp/otlp-unknown.proto <<'EOF'
syntax = "proto3";
message UnknownResponseField { uint64 future_field = 15; }
EOF
printf 'future_field: 7\n' | protoc -I /tmp \
  --encode=UnknownResponseField /tmp/otlp-unknown.proto \
  > /tmp/otlp-unknown-field.bin
cat "$FIXTURES/logs-response-large.bin" /tmp/otlp-unknown-field.bin \
  > "$FIXTURES/logs-response-large-unknown.bin"
```

The pinned collector response definitions declare both rejection counters as
signed `int64`, not `uint64`. The fixtures intentionally include a negative log
counter so the codec preserves it for the destination's response validator to
reject.
