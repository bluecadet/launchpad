---
"@bluecadet/launchpad-controller": minor
"@bluecadet/launchpad-utils": minor
"@bluecadet/launchpad-cli": minor
---

Add Node identity to controller config: `controller.node.id`, `node.label`, and the free-form `node.role` deployment tag now identify a launchpad daemon to remote clients. The identity appears in system state, in `launchpad status`, and in the `GET /status` snapshot header, so a client fanning out to several Nodes on one network can tell their responses apart. Unconfigured, `id` is derived from the machine's short hostname and `label` falls back to `id`, so existing configs are unaffected.

`GET /status` is the documented remote liveness check — the remote analogue of the pid-file check — rather than a separate liveness endpoint.

`SystemState` and `StatusSnapshot["header"]` gain a required `node` field; code that constructs either type (test fixtures, custom transports) must supply it.
