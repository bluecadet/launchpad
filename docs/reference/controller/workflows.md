---
title: "Workflows"
---
A workflow is a named, linear sequence of commands declared in config. The host runs one by name — from the controller API, from the `start`/`stop` lifecycle, or from a remote client over any transport. The recipe lives in the Node's config; the caller only supplies a name.

## Declaring workflows

```typescript
export default defineConfig({
  plugins: [content({}), monitor({})],
  workflows: {
    start: ['content.fetch', 'monitor.connect', 'monitor.start'],
    stop: ['monitor.stop', 'monitor.disconnect'],
    'tour-mode': ['monitor.stop', 'content.fetch', 'monitor.start'],
  },
});
```

Each step is a command id, a full command object (`{ type: 'content.fetch', sources: ['news'] }`), or a step object with options. Two names are conventional: `launchpad start` runs `start` after every plugin is ready, and `LaunchpadController.stop()` runs `stop` before plugins disconnect. Every other name is yours.

The controller exposes `setWorkflows()` and `runWorkflow()` for in-process callers.

## Step failure handling

Workflows run every step **best-effort**. If a step fails, the controller records the error, emits `workflow:step:error`, and continues with the remaining steps. After all steps run, the workflow reports an aggregated failure (`workflow:error`) if any step errored.

This means a failed `content.fetch` no longer prevents `monitor.start` from launching apps — content fetching stages its output before promoting it, so the previously-published content remains on disk and the monitor runs against the last good content.

`launchpad start` treats the aggregated failure the same way: it logs the errors and keeps the controller running, so a failed workflow step never takes down apps that started successfully.

To make a step fatal — halting the workflow and skipping the remaining steps when it fails — wrap it in an object with `stopOnError`:

```typescript
export default defineConfig({
  workflows: {
    // 'publish' is skipped if 'build' fails
    deploy: [{ step: 'build', stopOnError: true }, 'publish'],
  },
});
```

## Running a workflow remotely

The controller registers two commands of its own, in both task and persistent mode: `workflow.run` and `workflow.list`. They dispatch like any other command — over IPC, over HTTP, or from a plugin.

### `workflow.run`

```json
{ "type": "workflow.run", "name": "tour-mode" }
```

Runs the named workflow and resolves with its run record:

```json
{
  "runId": 3,
  "name": "tour-mode",
  "status": "success",
  "startedAt": "2026-07-14T15:31:02.004Z",
  "finishedAt": "2026-07-14T15:31:04.881Z",
  "durationMs": 2877,
  "stepCount": 3,
  "steps": [
    { "index": 0, "command": "monitor.stop", "status": "success", "durationMs": 412, "error": null },
    { "index": 1, "command": "content.fetch", "status": "success", "durationMs": 2103, "error": null },
    { "index": 2, "command": "monitor.start", "status": "success", "durationMs": 362, "error": null }
  ],
  "error": null
}
```

An unknown name errors, and so does a second run of a workflow already in flight. A workflow whose steps failed errors too — over HTTP that is a `500` — and the full record, including which step failed, is in state either way.

**`workflow.run` takes a name only. It never accepts inline steps.** Allowlisting it grants exactly the recipes in that Node's config and nothing a client can compose for itself. That is what makes remote control thin: the tablet sends one command per Node, and the multi-step recipe stays with the Node.

### `workflow.list`

```json
{ "type": "workflow.list" }
```

```json
{
  "workflows": [
    { "name": "start", "stepCount": 3, "lastRun": null },
    { "name": "tour-mode", "stepCount": 3, "lastRun": { "runId": 3, "status": "success", "...": "" } }
  ]
}
```

One call is enough for a cold-starting client: it learns what this Node can run and how each one last went.

### Exposing them over HTTP

A command has to appear in both `allowedCommands` and the presented token's role globs to be reachable, so show them together:

```typescript
httpTransport({
  allowedCommands: ['workflow.run', 'workflow.list'],
  auth: {
    roles: {
      // Token role: which commands this token may dispatch.
      docent: ['workflow.*'],
    },
    tokens: {
      'docent-tablet': { env: 'LAUNCHPAD_TOKEN_DOCENT', role: 'docent' },
    },
  },
});
```

Both ids share the `workflow.` prefix so one glob covers them. Neither is allowed by default, so a Node exposes them deliberately or not at all. See [Security posture](./security.md) for the whole model.

## Run outcomes in state

The controller keeps every run's outcome in its own state slice, `plugins.workflows`:

```typescript
{
  available: [{ name: 'start', stepCount: 3 }, { name: 'tour-mode', stepCount: 3 }],
  runs: {
    'tour-mode': { /* the WorkflowRun shown above */ },
  },
}
```

The contract:

- **Latest run per name only.** No history, no replay. A new run overwrites the previous record for that name. This bounds the slice: it grows with the number of configured workflows, never with the number of runs.
- **`runId` is monotonic per controller process**, starting at 1. It resets on daemon restart, and the slice starts empty — nothing about a run survives a restart.
- **`error` is a message string**, never an error object, a stack, or a `cause` chain.
- **Steps record command ids only** — never a step's params, never its return value. A step can dispatch a command whose result carries data that has no business in `/state` or on an SSE stream, so none of it is recorded.
- **A step's `command` is the id as written in config.** If a step names a command alias, the record keeps the alias rather than the canonical id.
- Every field is a JSON primitive, string, or array of the same, so the slice survives the [JSON projection](./wire-contract.md#serialization-and-lossiness) that `GET /state` and pushed state patches both use.

### Why state, not events

Workflow progress is also on the event bus (`workflow:start`, `workflow:step:*`, `workflow:success`, `workflow:error`), but events are only visible to whoever is connected when they fire. A tablet that reconnects mid-tour cannot replay them.

State is the recovery path. A client reads `plugins.workflows.runs['tour-mode']` — from `GET /state`, from `workflow.list`, or from an IPC state read — and learns how the run went regardless of when it connected. With `pushStatePatches` enabled, each step's completion also arrives as a `launchpad:state:patch` frame, so a connected client gets live per-step progress and a reconnecting one refetches. See [Controller Events](./events.md) and [State push frames](./wire-contract.md#state-push-frames).

## Status section

`launchpad status` and `GET /status` show a **Workflows** section when any workflow is configured, with one row per workflow:

| Run state | Status row |
| --- | --- |
| Never run this process | `never run · 4 steps` |
| In flight | `running · step 2 of 4` |
| Last run succeeded | `ok · 4 steps` |
| Last run failed | `failed · step 2 (monitor.start): ENOENT` |

## Limitations

- **Steps are linear.** No parallel step groups, no per-step timeout, no per-step retry. A fan-out client that wants parallelism runs one `workflow.run` per Node concurrently.
- **One run per name at a time.** Running a workflow that is already in flight errors rather than queuing. This also stops a self-referential or cyclic recipe (a workflow whose step is `workflow.run`) from recursing.
- **Nothing survives a restart.** Run records live in memory; `runId` restarts at 1 and the slice starts empty.
- **`workflows` is reserved.** The plugin name `workflows`, the state key `plugins.workflows`, and the `workflow.` command prefix belong to the controller. A host plugin claiming any of them fails registration.
