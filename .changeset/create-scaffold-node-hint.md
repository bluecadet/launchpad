---
"@bluecadet/create-launchpad": patch
---

Scaffolded configs now include a commented-out `controller.node` block pointing at the controller config reference. Node identity previously had no equivalent to the `httpTransport` and `workflows` hints already in the generated config, so a freshly scaffolded project gave no nudge toward setting `node.id` before its first multi-node deployment.
