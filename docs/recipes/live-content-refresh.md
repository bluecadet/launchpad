---
title: "Live content refresh"
---
> [!NOTE]
> Requires `@bluecadet/launchpad` 3.0.0 or later.

Live content refresh combines scheduled fetches with versioned content output. Applications read the [version manifest](../reference/content/version-manifest.md), reload when its `versionId` changes, and can hold a loaded version with an acknowledgment lease.

## Naive recipe

Add the scheduler and enable content versioning. Configure content sources as usual.

```ts
import { defineConfig } from "@bluecadet/launchpad/cli";
import { content } from "@bluecadet/launchpad/content";
import { scheduler } from "@bluecadet/launchpad/scheduler";

export default defineConfig({
	plugins: [content({ versioning: true }), scheduler({ "content.fetch": "5m" })],
});
```

Every successful fetch creates a new `versionId`, even when the CMS returned identical content, so a polling application reloads on every scheduled fetch. That is acceptable on a slow schedule. For a fast schedule, check before fetching.

## Check before fetching

> [!NOTE]
> Requires `@bluecadet/launchpad` 3.0.6 or later.

Add the content package's [`refetchChecker`](../reference/content/refetch-checker.md) plugin and schedule its `refetch.check` command instead of `content.fetch`. The check asks the CMS for its latest `modifiedAt` value and fetches only when that value is newer.

```ts
import { defineConfig } from "@bluecadet/launchpad/cli";
import { content, refetchChecker } from "@bluecadet/launchpad/content";
import { scheduler } from "@bluecadet/launchpad/scheduler";

// Replace with the request appropriate to your CMS.
async function getCmsModifiedAt(signal: AbortSignal): Promise<string> {
	const response = await fetch("https://cms.example.com/api/last-modified", { signal });
	const body = (await response.json()) as { modifiedAt: string };
	return body.modifiedAt;
}

export default defineConfig({
	plugins: [
		content({ versioning: true }),
		refetchChecker({
			getLatestModifiedAt: ({ abortSignal }) => getCmsModifiedAt(abortSignal),
		}),
		scheduler({ "refetch.check": "30s" }),
	],
});
```

`getLatestModifiedAt` is the only CMS-specific part. Return the most recent modification value your CMS reports, in a format whose lexicographic order matches chronological order, such as an ISO 8601 timestamp. Use whichever freshness signal your CMS reports most reliably; the checker handles the rest.

The first check after boot compares the CMS value with the active manifest's `generatedAt`. Later checks compare CMS values in memory. If the manifest is missing or cannot be read, the checker fetches unconditionally.

The check completes only after its fetch finishes. Scheduler intervals therefore start after the whole check-and-fetch cycle, and a failed fetch goes to the scheduler's normal retry policy. The checker records the CMS value only after a successful fetch, so the next check retries a failed one.

## Node consumers with `IPCClient`

Polling `manifest.json` remains the contract: poll every 5 to 30 seconds and reload when `versionId` changes. In daemon mode, a Node application can also listen for `content:version:promoted` to learn of new versions sooner. Delivery is best-effort, so keep polling; a missed event must never prevent a refresh.

```ts
import "@bluecadet/launchpad/content/events";
import { IPCClient } from "@bluecadet/launchpad/controller/ipc-client";

const socketPath = ".launchpad/launchpad.sock";
const consumerId = "kiosk-main";
const client = new IPCClient();

await client.connect(socketPath);

client.on("content:version:promoted", async ({ versionId }) => {
	await reloadContent();
	await client.executeCommand({
		type: "content.ack",
		consumerId,
		versionId,
	});
});

async function reloadContent(): Promise<void> {
	// Read manifest.json and switch only when your application is ready.
}
```

`reloadContent()` reads the manifest and switches to its declared paths when your application is ready. After the promoted version loads, `content.ack` renews that consumer's retention lease over the same socket. The event name and its `{ versionId, versionPath, generatedAt }` payload are the public contract; the IPC wire protocol is not.

## Browser and Unity consumers over HTTP

Consumers that can't open a Unix socket, such as browser pages and Unity/.NET clients, can use the [HTTP/SSE transport](../reference/controller/transports.md). Add it to your plugins next to `content` and `scheduler`:

```ts
import { defineConfig } from "@bluecadet/launchpad/cli";
import { content } from "@bluecadet/launchpad/content";
import { httpTransport } from "@bluecadet/launchpad/controller/transports/http";
import { scheduler } from "@bluecadet/launchpad/scheduler";

export default defineConfig({
	plugins: [
		content({ versioning: true }),
		scheduler({ "content.fetch": "5m" }),
		httpTransport({ port: 8710 }),
	],
});
```

`GET /events` streams the same `content:version:promoted` event as a Server-Sent Event, and `POST /command` dispatches `content.manifest.read` and `content.ack` over plain HTTP:

```bash
# Read the active manifest
curl -X POST http://127.0.0.1:8710/command \
  -H 'Content-Type: application/json' \
  -d '{"type":"content.manifest.read"}'

# Renew this consumer's retention lease after loading a version
curl -X POST http://127.0.0.1:8710/command \
  -H 'Content-Type: application/json' \
  -d '{"type":"content.ack","consumerId":"unity-kiosk","versionId":"20260714T153045Z"}'
```

On connect, the stream [replays](../reference/controller/transports.md#replay-on-connect) the last frame of each event it has seen, so a page that opens long after the last promotion receives `content:version:promoted` immediately.

As with IPC, push is best-effort. Keep polling `manifest.json` so a missed SSE event never prevents a refresh.

### C# (Unity/.NET)

`HttpClient.GetStreamAsync` returns the raw SSE stream. Parse `event:` and `data:` lines yourself and reconnect when the connection drops:

```csharp
var client = new HttpClient();

while (true)
{
    try
    {
        using var stream = await client.GetStreamAsync("http://127.0.0.1:8710/events");
        using var reader = new StreamReader(stream);

        string? eventName = null;
        string? line;
        while ((line = await reader.ReadLineAsync()) != null)
        {
            if (line.StartsWith("event: "))
            {
                eventName = line.Substring("event: ".Length);
            }
            else if (line.StartsWith("data: "))
            {
                var data = line.Substring("data: ".Length);
                if (eventName == "content:version:promoted")
                {
                    HandlePromoted(data); // reload content, then POST content.ack
                }
            }
            else if (line.Length == 0)
            {
                eventName = null; // blank line ends the frame
            }
        }
    }
    catch (HttpRequestException)
    {
        // Connection dropped or the transport isn't up yet; fall through to reconnect.
    }

    await Task.Delay(TimeSpan.FromSeconds(2));
}
```

This minimal line loop ignores `retry:` lines, multi-line `data:` fields, and `id:`-based resumption. It catches `content:version:promoted` early; the manifest poll still guarantees the refresh.

### Browser

`EventSource` handles parsing and reconnection. Pair it with a slow manifest poll as the fallback:

```ts
const eventsUrl = "http://127.0.0.1:8710/events";
const commandUrl = "http://127.0.0.1:8710/command";
const consumerId = "kiosk-browser";

let loadedVersionId: string | undefined;

// Push over SSE is best-effort sugar: it lowers latency, but the poll
// fallback below is what actually guarantees a refresh.
const eventSource = new EventSource(eventsUrl);

eventSource.addEventListener("content:version:promoted", async (event) => {
	const { versionId } = JSON.parse(event.data) as { versionId: string };
	await loadVersion(versionId);
});

// Slow poll fallback: covers a missed SSE event, a dropped connection before
// reconnect, or the transport being unavailable entirely.
setInterval(async () => {
	const response = await fetch("/content/manifest.json", { cache: "no-store" });
	const manifest = (await response.json()) as { versionId: string };
	await loadVersion(manifest.versionId);
}, 30_000);

async function loadVersion(versionId: string): Promise<void> {
	if (versionId === loadedVersionId) {
		return;
	}
	await reloadContent();
	loadedVersionId = versionId;
	await ackVersion(versionId);
}

async function ackVersion(versionId: string): Promise<void> {
	await fetch(commandUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type: "content.ack", consumerId, versionId }),
	});
}

async function reloadContent(): Promise<void> {
	// Read manifest.json and switch only when your application is ready.
}
```
