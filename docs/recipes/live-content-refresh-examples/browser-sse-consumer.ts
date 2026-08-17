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
