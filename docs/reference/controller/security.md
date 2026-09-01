---
title: "Security posture"
---
Launchpad runs on exhibition floors, where the interesting attacker is usually a laptop somebody plugged into a wall port, not a determined adversary on the open internet. The v1 posture is sized for that: **a trusted VLAN plus tokens, no TLS.** This page states what that buys you, what it doesn't, and how to configure it.

## Trust boundaries at a glance

| Transport | Wire | Access control | Auth |
| --- | --- | --- | --- |
| IPC (`launchpad start` ↔ CLI) | Unix socket, named pipe on Windows | Filesystem permissions on the socket path | **None, by design** |
| HTTP/SSE (`httpTransport`) | TCP | Tokens, token roles, `allowedCommands`, `allowedOrigins` | Optional, off by default |

The IPC transport is deliberately exempt from tokens and command allowlisting. Its trust boundary is the filesystem: any local process that can open the socket can dispatch any registered command, including shutdown. That is the same boundary a local process already has over the daemon's files and signals, so adding a token would move nothing.

The HTTP transport has no such boundary to lean on. A loopback TCP port is reachable by every process on the machine, and — because browsers let `no-cors` cross-origin requests complete even when the response is opaque to the page — by JavaScript in any tab the user has open. Everything below is about that transport.

## The v1 posture: trusted VLAN plus tokens

Traffic is plaintext HTTP. Anyone who can sniff the network segment can read tokens and payloads off the wire. Launchpad assumes the exhibition network is physically controlled and carries no untrusted hosts.

Explicitly out of scope for v1:

- **TLS.** Put a reverse proxy in front of the transport if you need it.
- **Token rotation and issuance.** Tokens are static config. Changing one means editing the environment and restarting the daemon.
- **Per-client event scoping.** See [Stated limitations](#stated-limitations).

## Configuring tokens

Tokens are declared by name. The config carries the *name of an environment variable*; the value lives in the environment, loaded from a `.env` file with [`--env`](../cli/env.md) or exported by whatever supervises the daemon. There is no way to write a token value inline — the option has no field for one.

```typescript
httpTransport({
  host: "0.0.0.0",
  allowedOrigins: ["http://tablet.local:3000"],
  allowedCommands: ["content.ack", "content.manifest.read", "monitor.restart"],
  auth: {
    roles: {
      docent: ["content.*", "monitor.*"],
      kiosk: ["content.ack"],
    },
    tokens: {
      "docent-tablet": { env: "LAUNCHPAD_TOKEN_DOCENT", role: "docent" },
      "lobby-kiosk": { env: "LAUNCHPAD_TOKEN_KIOSK", role: "kiosk" },
    },
  },
})
```

```bash
# .env.local — gitignored by the project scaffold
LAUNCHPAD_TOKEN_DOCENT=3f9c1a…
LAUNCHPAD_TOKEN_KIOSK=b71e40…
```

A few rules the transport enforces at startup, so a half-configured deployment fails loudly instead of rejecting every client at runtime:

- A token whose environment variable is unset or empty fails setup, naming the token and the variable.
- Two tokens resolving to the same value fail setup — their roles would be ambiguous.
- A token naming a role that isn't in `roles` fails config validation.
- Declaring `auth.roles` with no `auth.tokens` fails setup. A role nothing points at can never be presented, so the transport would start fully unauthenticated despite looking configured — `allowUnauthenticated: true` does **not** suppress this one, since it addresses a different question (whether an open transport on a non-loopback host is acceptable), not a self-contradictory role config.
- Binding a non-loopback `host` with no tokens configured fails setup. Set `allowUnauthenticated: true` if you really want an open command endpoint on the network.

These checks run in task mode too, so a one-shot CLI run surfaces a broken auth config without binding a port.

Token *names* are operator-authored labels, not secrets: they appear in log lines and error messages so you have an audit trail. Every request logs its authentication outcome:

- A successful authentication logs the token name and role at `debug` — for example `HTTP transport authenticated "docent-tablet" (role "docent") for POST /command`. This is `debug`, not `info`, because `POST /command` can be called once per request at whatever rate a client polls, and a routine outcome should not flood default log output.
- A rejected request (missing or unknown token) logs at `warn` — for example `HTTP transport rejected POST /command: missing or unknown token`. Rejections are security-relevant regardless of volume, so they always surface.
- An anonymous request against an unauthenticated transport (no `auth.tokens` configured at all) logs nothing: there is no token to name, and every request would otherwise add a line to an already-open deployment's logs.

Token *values* never appear in logs, in state, in `GET /status`, or in any error body — including the `400` for a malformed request target, whose query string is redacted because `GET /events` accepts a token there.

There is no minimum token length. Generate at least 32 random characters; nothing will stop you from using `hunter2`.

## Token roles and command globs

Every token names exactly one **token role**, and a role is a list of command globs. The syntax is the same as the `events` filter: an entry ending in `*` prefix-matches everything before it, `*` alone matches everything, anything else is an exact match. An empty list is legal and means "no commands".

> [!NOTE]
> A **token role** is unrelated to `controller.node.role`, which is a free-form deployment tag on the Node itself. See [Controller Config](./controller-config.md#node).

**A role only ever narrows.** The effective permission is `allowedCommands` intersected with the role's globs:

```
effective = allowedCommands ∩ role globs
```

So a misconfigured role can never grant more than the transport already offers — and, less happily, a command added to a role but not to `allowedCommands` is still `403`. In the example above, `docent` lists `monitor.*`, and `monitor.restart` is in `allowedCommands`, so a docent token can dispatch it. Add `monitor.shutdown` to the role and nothing changes: it isn't in `allowedCommands`.

Two habits worth adopting:

- **Name destructive commands explicitly.** `monitor.*` covers `monitor.shutdown` as well as `monitor.restart`. Write the ids out when a glob would sweep in something you'd rather approve one at a time.
- **Keep `allowedCommands` tight anyway.** It is the gate that applies to every caller, authenticated or not.

## Status codes

| Status | Meaning |
| --- | --- |
| `401` | No token was presented, or the presented token is unknown. The response carries `WWW-Authenticate: Bearer`. |
| `403` `Command not allowed: <type>` | The command isn't in `allowedCommands`. This gate runs first, and applies to anonymous callers too. |
| `403` `Command not permitted for role "<role>": <type>` | The token is valid, but its role's globs don't cover the command. |

These are the codes the auth gates produce. A request that clears both gates and then fails at dispatch answers `404`, `400`, or `500` depending on why — see the [Wire Contract's command failure table](./wire-contract.md#command-failures-carry-a-reason). A `404` there is not an auth outcome: an unauthorized caller never learns whether a command exists, because the `403` fires first.

A client presents a token one of two ways:

- `Authorization: Bearer <token>` on any route.
- `?access_token=<token>` on `GET /events` only, because browser `EventSource` cannot set request headers. Any other route rejects it, which keeps tokens out of URLs where they'd have no reason to be.

Authentication gates the **whole** surface — `/status`, `/state`, `/events`, `/command`, and unknown paths all answer `401` — so an anonymous caller can't map the API by reading status codes. Preflights are the one exception: `OPTIONS` is answered before the auth gate, since browsers never attach `Authorization` to a preflight.

**Any valid token is a full-read credential.** Roles gate commands, not reads. A token with an empty role list still reads `GET /status`, still reads `GET /state` when `exposeState` is on, and still receives every SSE frame. "Read-only" here means *no writes*, not *restricted reads*.

## CORS

`allowedOrigins` controls `Access-Control-Allow-Origin`:

- `["*"]` (the default) answers every request with `Access-Control-Allow-Origin: *`.
- Any other list echoes the request's `Origin` when it matches exactly, and adds `Vary: Origin`.
- An unlisted origin gets no `Access-Control-Allow-Origin` at all. The browser then refuses to expose the response to the page.

Note the shape of that last case: the request **still ran**. CORS is a control the browser applies to reading a response, not one the server applies to handling a request, and it does nothing at all to a Unity client or a `curl`. It is a defense against a page in another tab reading your data, never a substitute for a token.

`*` is defensible in combination with tokens, because a cross-origin page still has no token to send. Without tokens it is exactly as open as it looks.

## Stated limitations

- **No TLS.** Plaintext on the wire; tokens are sniffable by anyone on the segment.
- **Events are transport-global.** Every authenticated SSE client receives every event that passes the `events` filter, regardless of its token role. Don't put role-sensitive data in event payloads — the answer to "this client shouldn't see it" is to keep it out of the event, not to scope the stream.
- **No token rotation or issuance.** Editing the environment and restarting is the rotation story.
- **Token comparison is not constant-time.** Timing attacks are a threat from an attacker already on the trusted VLAN, which is outside the v1 posture.
- **The IPC transport is unauthenticated by design.** Filesystem permissions are its whole access control.

## Checklist before binding beyond loopback

1. Configure at least one token, with a value of at least 32 random characters.
2. Give each token the narrowest role that does its job, and name destructive commands explicitly rather than globbing them.
3. Narrow `allowedCommands` to what the deployment actually needs.
4. Narrow `allowedOrigins` to the pages that legitimately talk to this Node.
5. Leave `exposeState: false` unless a client genuinely needs the full state tree.
6. Keep the port off any routable interface — a VLAN the public can't reach, and a firewall that says so.
