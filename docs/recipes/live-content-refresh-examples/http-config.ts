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
