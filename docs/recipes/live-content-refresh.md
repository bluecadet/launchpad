---
title: "Live Content Refresh"
---
> [!NOTE]
> Requires `@bluecadet/launchpad` 3.0.0 or later.

Live content refresh combines scheduled fetches with versioned content output. Applications read the [version manifest](../reference/content/version-manifest.md), reload when its `versionId` changes, and can keep a loaded version with an acknowledgment lease.

## Naive recipe

Add the scheduler and enable content versioning. Configure your content sources as usual.

<<< ./live-content-refresh-examples/naive-config.ts

Every successful fetch creates a new `versionId`, even when the CMS returned identical content. A polling application will therefore reload on every scheduled fetch. This is fine for a slow schedule. For a fast schedule, use the check-before-fetch recipe below.

## Check before fetching

> [!NOTE]
> Requires `@bluecadet/launchpad` 3.1.0 or later.

Add the content package's [`refetchChecker`](../reference/content/refetch-checker.md) plugin and schedule its `refetch.check` command instead of `content.fetch`. The check asks the CMS for its latest `modifiedAt` value, then fetches only when that value is newer.

<<< ./live-content-refresh-examples/checked-config.ts

`getLatestModifiedAt` is the only CMS-specific part: return the most recent modification value your CMS reports, in a format whose lexicographic order matches chronological order (an ISO 8601 timestamp qualifies). Each CMS chooses its most reliable freshness signal; the checker supplies the rest.

The first check after boot compares the CMS value with the active manifest's `generatedAt`. Later checks compare CMS values in memory. If the manifest is missing or cannot be read, the checker fetches unconditionally.

The fetch is awaited before the check completes. Scheduler intervals are therefore measured after the whole check-and-fetch cycle, and a fetch failure is reported to the scheduler for its normal retry policy. The last seen CMS value is recorded only after a successful fetch, so a failed fetch is tried again.

## Node consumers with `IPCClient`

Polling `manifest.json` remains the contract: poll every 5–30 seconds and reload when `versionId` changes. In daemon mode, a Node application can also receive `content:version:promoted` as lower-latency notification. The event is best-effort sugar; keep polling so a missed event never prevents a refresh.

<<< ./live-content-refresh-examples/ipc-consumer.ts

`reloadContent()` should read the manifest and switch to its declared paths only when your application is ready. After it has loaded the promoted version, `content.ack` renews that consumer's retention lease over the same socket. The public commitment is the event name and its `{ versionId, versionPath, generatedAt }` payload; the IPC wire protocol is not part of this recipe.

## Browser and Unity consumers over HTTP

Consumers that can't open a Unix socket — browser pages, Unity/.NET clients — can use the [HTTP/SSE transport](../reference/controller/transports.md) instead. Add it to your plugins next to `content` and `scheduler`:

<<< ./live-content-refresh-examples/http-config.ts

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

On connect, the stream [replays](../reference/controller/wire-contract.md#replay-on-connect) the last frame of each event it has seen, so a page that opens long after the last promote still gets `content:version:promoted` immediately rather than waiting for the next one.

As with the IPC transport, push is best-effort: keep polling `manifest.json` so a missed SSE event never prevents a refresh. Live frames carry a monotonic `id:`, so a client can also notice a gap the moment it happens and re-read the manifest instead of waiting for the next poll — see [Sequence numbers and reconnection](../reference/controller/wire-contract.md#sequence-numbers-and-reconnection). That counter runs across every forwarded frame, which is why the config above narrows `events` to the one event these consumers handle. Reconnecting does not resume the stream: `Last-Event-ID` is ignored, and the client rebaselines.

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

A hand-rolled reader should also parse the `id:` line — it arrives ahead of `event:` on every live frame — and treat any value other than the previous one plus 1 as a cue to re-read `manifest.json`. Frames without an `id:` are the replay backlog and keep-alives; they never advance the baseline.

This is a minimal line loop, not a full SSE client: it doesn't honor the `retry:` line, multi-line `data:` fields, or the `id:` sequence check above (and the server ignores `Last-Event-ID`, so there is no resumption to implement). It's enough to catch `content:version:promoted` as a low-latency nudge — the manifest poll is still what makes the refresh correct.

See the full [browser `EventSource` example](https://github.com/bluecadet/launchpad/blob/main/docs/recipes/live-content-refresh-examples/browser-sse-consumer.ts) for the equivalent consumer in TypeScript, including a poll-fallback interval.
