---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-client": minor
"@bluecadet/launchpad-docs": patch
---

`POST /command` rejects two ways before a command ever reaches a handler: the type isn't in the transport's `allowedCommands`, or the token's role doesn't cover it. Both answered `403` with a body carrying only `message`, so a client had no way to tell them apart without parsing that message against the wire contract's explicit warning not to. The allowlist gate now puts `reason: "not-allowed"` on its body, and the role gate puts `reason: "role-denied"` on its. Neither body gains `name` or `commandType` — those stay exclusive to a `CommandExecutionError`, since both gates run ahead of dispatch and there is no dispatch failure to describe.

This is additive to wire contract v1, not a new version: the contract already commits a client to falling back to the status code for an unrecognized `error.reason`, so an existing client that treats every `403` as opaque keeps working exactly as before. What changes is that a client written against this SDK can now ask which cause it hit.

On the client side, `CommandErrorReason` gains a new `CommandRejectionReason` member (`"not-allowed" | "role-denied"`), unioned in alongside the three existing `CommandFailureReason` values and the transport-level `ClientErrorReason` set. `"forbidden"` remains in play as the fallback a `403` collapses onto when its body carries no reason the SDK recognizes — an older Node, or a proxy that strips the field. A caller that wants the previous coarse behavior does nothing differently; one that wants the finer distinction switches on `error.reason` and adds `"not-allowed"` and `"role-denied"` arms, most usefully to tell an operator's own allowlist configuration apart from a token issued with too narrow a role. Both new reasons come from the runtime gate in the HTTP client that decides which wire strings are trusted, so a Node running an older controller version that doesn't send them still falls through to the status-code default without any special casing.

The wire-contract and client API reference pages document both reasons in the same places their existing counterparts live: the `POST /command` status table and the client error table, plus a short explanation of why these two omit the fields a dispatch failure carries.
