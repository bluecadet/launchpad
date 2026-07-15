---
title: "Live Content Refresh"
---

# Live Content Refresh

> [!NOTE]
> Requires `@bluecadet/launchpad` 3.0.0 or later.

Live content refresh combines scheduled fetches with versioned content output. Applications read the [version manifest](/reference/content/version-manifest), reload when its `versionId` changes, and can keep a loaded version with an acknowledgment lease.

## Naive recipe

Add the scheduler and enable content versioning. Configure your content sources as usual.

<<< ./live-content-refresh-examples/naive-config.ts

Every successful fetch creates a new `versionId`, even when the CMS returned identical content. A polling application will therefore reload on every scheduled fetch. This is fine for a slow schedule. For a fast schedule, use the check-before-fetch recipe below.

## Check before fetching

Schedule a CMS-specific `refresh.check` command instead of `content.fetch`. It asks the CMS for its latest `modifiedAt` value, then fetches only when that value is newer.

<<< ./live-content-refresh-examples/refresh-plugin.ts

Replace `getCmsModifiedAt()` with the request appropriate to your CMS. The first check after boot compares the CMS value with the active manifest's `generatedAt`. Later checks compare CMS values in memory. If the manifest is missing or cannot be read, the plugin fetches unconditionally.

The fetch is awaited before the check completes. Scheduler intervals are therefore measured after the whole check-and-fetch cycle, and a fetch failure is reported to the scheduler for its normal retry policy. `lastSeen` is updated only after a successful fetch, so a failed fetch is tried again.

Register the plugin, schedule its command, and keep versioning enabled:

<<< ./live-content-refresh-examples/checked-config.ts

This plugin is deliberately application-specific. It keeps the scheduler command-agnostic and lets each CMS choose the most reliable freshness signal.

## Node consumers with `IPCClient`

Polling `manifest.json` remains the contract: poll every 5–30 seconds and reload when `versionId` changes. In daemon mode, a Node application can also receive `content:version:promoted` as lower-latency notification. The event is best-effort sugar; keep polling so a missed event never prevents a refresh.

<<< ./live-content-refresh-examples/ipc-consumer.ts

`reloadContent()` should read the manifest and switch to its declared paths only when your application is ready. After it has loaded the promoted version, `content.ack` renews that consumer's retention lease over the same socket. The public commitment is the event name and its `{ versionId, versionPath, generatedAt }` payload; the IPC wire protocol is not part of this recipe.
