---
title: "Live Content Refresh"
---
> [!NOTE]
> Requires `@bluecadet/launchpad` 3.0.0 or later.

Live content refresh combines scheduled fetches with versioned content output. Applications read the [version manifest](../reference/content/version-manifest.md), reload when its `versionId` changes, and can keep a loaded version with an acknowledgment lease.

## Naive recipe

Add the scheduler and enable content versioning. Configure your content sources as usual.

```ts
import { defineConfig } from "@bluecadet/launchpad/cli";
import { content } from "@bluecadet/launchpad/content";
import { scheduler } from "@bluecadet/launchpad/scheduler";

export default defineConfig({
	plugins: [content({ versioning: true }), scheduler({ "content.fetch": "5m" })],
});
```

Every successful fetch creates a new `versionId`, even when the CMS returned identical content. A polling application will therefore reload on every scheduled fetch. This is fine for a slow schedule. For a fast schedule, use the check-before-fetch recipe below.

## Check before fetching

> [!NOTE]
> Requires `@bluecadet/launchpad` 3.0.6 or later.

Add the content package's [`refetchChecker`](../reference/content/refetch-checker.md) plugin and schedule its `refetch.check` command instead of `content.fetch`. The check asks the CMS for its latest `modifiedAt` value, then fetches only when that value is newer.

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

`getLatestModifiedAt` is the only CMS-specific part: return the most recent modification value your CMS reports, in a format whose lexicographic order matches chronological order (an ISO 8601 timestamp qualifies). Each CMS chooses its most reliable freshness signal; the checker supplies the rest.

The first check after boot compares the CMS value with the active manifest's `generatedAt`. Later checks compare CMS values in memory. If the manifest is missing or cannot be read, the checker fetches unconditionally.

The fetch is awaited before the check completes. Scheduler intervals are therefore measured after the whole check-and-fetch cycle, and a fetch failure is reported to the scheduler for its normal retry policy. The last seen CMS value is recorded only after a successful fetch, so a failed fetch is tried again.

## Node consumers with `IPCClient`

Polling `manifest.json` remains the contract: poll every 5–30 seconds and reload when `versionId` changes. In daemon mode, a Node application can also receive `content:version:promoted` as lower-latency notification. The event is best-effort sugar; keep polling so a missed event never prevents a refresh.

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

`reloadContent()` should read the manifest and switch to its declared paths only when your application is ready. After it has loaded the promoted version, `content.ack` renews that consumer's retention lease over the same socket. The public commitment is the event name and its `{ versionId, versionPath, generatedAt }` payload; the IPC wire protocol is not part of this recipe.

## Browser and Unity consumers over HTTP

Consumers that can't open a Unix socket — browser pages, Unity/.NET clients — can use the [HTTP/SSE transport](../reference/controller/transports.md) instead. Add it to your plugins next to `content` and `scheduler`:

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

On connect, the stream [replays](../reference/controller/transports.md#replay-on-connect) the last frame of each event it has seen, so a page that opens long after the last promote still gets `content:version:promoted` immediately rather than waiting for the next one.

As with the IPC transport, push is best-effort: keep polling `manifest.json` so a missed SSE event never prevents a refresh.

### C# (Unity/.NET)

`HttpClient.GetStreamAsync` gives you the raw SSE stream; parse `event:`/`data:` lines yourself and reconnect on drop:

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

This is a minimal line loop, not a full SSE client: it doesn't honor the `retry:` line, multi-line `data:` fields, or `id:`-based resumption. It's enough to catch `content:version:promoted` as a low-latency nudge — the manifest poll is still what makes the refresh correct.

### Browser

`EventSource` handles parsing and reconnects for you. Pair it with a slow manifest poll as the fallback:

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
