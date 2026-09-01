---
"@bluecadet/launchpad-controller": major
"@bluecadet/create-launchpad": patch
---

Add token authentication, token roles, and configurable CORS to `httpTransport`.

Tokens are declared by name in config and resolved from environment variables — token values never appear in config, logs, state, or `GET /status`. Each token names a token role, and roles map to command allowlists using the same prefix-glob syntax as the `events` filter (`content.*`, `monitor.restart`, `*`). Present a token as `Authorization: Bearer <token>` on any route, or as `?access_token=` on `GET /events`, where browser `EventSource` cannot set headers.

Authentication gates the whole HTTP surface: with tokens configured, `/status`, `/state`, `/events`, `/command`, and unknown paths all answer `401` without one, so any valid token is a full-read credential. Authorization gates `POST /command` only: a command outside the token role's globs gets `403`. The effective permission is `allowedCommands` intersected with the role globs, so a role can only narrow access.

Authentication outcomes are logged, which is what makes the token *name* an audit trail. A successful authentication logs the token name and role at `debug` — `POST /command` can run once per request, so a routine outcome stays out of default `info` output. A rejected request logs at `warn`, since it is security-relevant regardless of volume. An anonymous request against a transport with no tokens configured logs nothing. Token values never reach a log line, and neither does the query string, so a token presented via `?access_token=` cannot leak into logs.

`Access-Control-Allow-Origin` is now driven by the new `allowedOrigins` option instead of always being `*`, preflights advertise `Authorization`, and `allowedCommands` entries are prefix-glob matched.

**Breaking:** binding `httpTransport` to a non-loopback `host` with no tokens configured is now a setup error, in task mode as well as persistent mode — a CI task run with `host: "0.0.0.0"` will start failing. Configure `auth.tokens`, or set `allowUnauthenticated: true` to keep the old behavior.

**Breaking:** declaring `auth.roles` with no `auth.tokens` is also a setup error. A role that no token points at can never be presented, so the transport would otherwise start fully unauthenticated while looking configured. `allowUnauthenticated: true` does not suppress this one — it answers whether an open transport on a non-loopback host is acceptable, which is a different question from a self-contradictory role config. Configure `auth.tokens`, or remove `auth.roles`.

The IPC transport is unchanged and stays exempt from auth and command allowlisting — its trust boundary is filesystem permissions on the socket path.

The `create` scaffold now emits a commented-out `auth` example in generated configs.
