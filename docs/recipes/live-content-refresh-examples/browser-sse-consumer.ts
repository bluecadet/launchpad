const eventsUrl = "http://127.0.0.1:8710/events";
const commandUrl = "http://127.0.0.1:8710/command";
const consumerId = "kiosk-browser";

let loadedVersionId: string | undefined;

// Push over SSE is best-effort sugar: it lowers latency, but the poll
// fallback below is what actually guarantees a refresh.
const eventSource = new EventSource(eventsUrl);

// Every live frame carries a monotonic id, counting every frame the transport
// broadcasts — not just the ones this page listens for. The config narrows
// `events` to `content:version:promoted` so this single listener sees them all;
// widen the filter and the check below has to widen with it. A value other than
// lastSeq + 1 (including a decrease, which means the daemon restarted) says a
// frame was missed, so read the authoritative manifest instead of the payload.
let lastSeq: number | undefined;

function isContiguous(event: MessageEvent): boolean {
	const seq = Number(event.lastEventId);
	const contiguous = lastSeq === undefined || seq === lastSeq + 1;
	lastSeq = seq;
	return contiguous;
}

// A dropped connection is a gap the ids can't show: the counter kept running
// while this page was away, and EventSource reports the last id it saw even on
// the un-sequenced frames it replays on reconnect. So rebaseline and re-read.
eventSource.addEventListener("open", () => {
	if (lastSeq === undefined) {
		return; // First connect — nothing to resync.
	}
	lastSeq = undefined;
	void refreshFromManifest();
});

eventSource.addEventListener("content:version:promoted", async (event) => {
	if (!isContiguous(event)) {
		await refreshFromManifest();
		return;
	}
	const { versionId } = JSON.parse(event.data) as { versionId: string };
	await loadVersion(versionId);
});

// Slow poll fallback: covers a missed SSE event, a dropped connection before
// reconnect, or the transport being unavailable entirely.
setInterval(refreshFromManifest, 30_000);

async function refreshFromManifest(): Promise<void> {
	const response = await fetch("/content/manifest.json", { cache: "no-store" });
	const manifest = (await response.json()) as { versionId: string };
	await loadVersion(manifest.versionId);
}

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
