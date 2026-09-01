---
"@bluecadet/launchpad-controller": major
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-docs": patch
---

A command dispatch failure now carries a `reason` discriminant, and each transport maps it to its own vocabulary instead of collapsing every failure into one code. `CommandExecutionError` gains a required `reason` of `not-registered`, `invalid`, or `handler-failed`, and `PluginContext.dispatchCommand` is typed `ResultAsync<unknown, CommandDispatchError>` rather than erasing the error to plain `Error`, so the reason survives from the dispatcher out to a transport. HTTP puts it on the response body; IPC uses it to derive the JSON-RPC error code rather than carrying the `reason` field itself, since the IPC serializer keeps only an `Error`'s name, message, stack, and cause across the wire.

**Breaking:** `POST /command` answered `500` for every failure past the `allowedCommands` and role gates. It now answers `404` for a command no plugin on the Node implements, `400` for a command whose own parameters failed its parser, and `500` only for a handler that actually failed. A command the operator allowlisted from a plugin the Node doesn't run — `content.ack` without the content plugin, say — was the reachable case, and it read as "the server is broken" when the honest answer is "this Node has no such command, and retrying will not change that." The failure body keeps its `{"error": {...}}` shape and its `name: "CommandExecutionError"`, and gains `reason` plus the canonical `commandType`. A client that told the three cases apart by matching `error.message` against `Command '<type>' is not registered`, `Invalid command: <type>`, or `Plugin command execution failed` should switch to `error.reason`; the messages are no longer part of the wire contract and may be reworded.

The IPC transport's JSON-RPC errors follow the same split: `METHOD_NOT_FOUND` (-32601) for an unregistered command, the newly added `INVALID_PARAMS` (-32602) for bad parameters, and `INTERNAL_ERROR` (-32603) for a handler failure, where all three were previously `INTERNAL_ERROR`. Its `executeCommand` handler also stops rewrapping the dispatch error in a fresh `CommandExecutionError`, which had discarded the original `reason` and `commandType` before the code could be derived from them.

The wire contract page documenting this behavior was amended in place rather than given a new contract version, since wire contract v1 had not yet been published when this change landed.

**Breaking:** a plugin manifest that fails to register — a duplicate command id, or an alias colliding with a registered command — now rejects with a `CommandRegistrationError` rather than a `CommandExecutionError`. Registration is a startup failure that never reaches a client, so it carries no dispatch reason. `CommandRegistry.registerMany` narrows its error channel to match.
