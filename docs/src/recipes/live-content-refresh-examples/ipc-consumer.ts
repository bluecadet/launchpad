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
