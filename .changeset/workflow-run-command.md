---
"@bluecadet/launchpad-controller": minor
"@bluecadet/create-launchpad": patch
---

Register `workflow.run` and `workflow.list` as core commands and record every run's outcome in state.

A remote client — a tablet, a browser page, a Unity app — triggers a config-declared workflow by name over any transport, and reads the run's per-step results from `plugins.workflows.runs` instead of replaying event history, so a client that reconnects after a run still learns how it went. `workflow.list` answers with every configured workflow, its step count, and its latest run, which is all a cold-starting client needs from one call.

`workflow.run` accepts a name only, never inline steps, so allowlisting it grants exactly the recipes in that Node's config. Neither command is in the default `allowedCommands`; a node opts in, and a token role glob of `workflow.*` covers both.

Run records keep step command ids, statuses, and durations — command params and return values never enter state. Only the latest run per workflow name is kept: no history, and nothing survives a daemon restart. Running a workflow that is already in flight now errors instead of starting a second run, which also stops a self-referential recipe from recursing.

`launchpad status` and `GET /status` gain a Workflows section. The plugin name `workflows`, the state key `plugins.workflows`, and the `workflow.` command prefix are now reserved by the controller.

The `create` scaffold points at `workflow.run` in generated configs that declare workflows.
