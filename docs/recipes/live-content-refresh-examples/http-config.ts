import { defineConfig } from "@bluecadet/launchpad/cli";
import { content } from "@bluecadet/launchpad/content";
import { httpTransport } from "@bluecadet/launchpad/controller/transports/http";
import { scheduler } from "@bluecadet/launchpad/scheduler";

export default defineConfig({
	plugins: [
		content({ versioning: true }),
		scheduler({ "content.fetch": "5m" }),
		httpTransport({
			port: 8710,
			// The SSE `id:` counter covers every forwarded frame, so narrowing the
			// stream to the one event consumers listen for keeps their gap check
			// meaningful. Drop this to forward the rest of `content:*`.
			events: ["content:version:promoted"],
			// `allowedCommands` defaults to empty; list the commands this recipe's
			// consumers dispatch over `POST /command`.
			allowedCommands: ["content.ack", "content.manifest.read"],
		}),
	],
});
