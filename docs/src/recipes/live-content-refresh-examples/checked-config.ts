import { defineConfig } from "@bluecadet/launchpad/cli";
import { content } from "@bluecadet/launchpad/content";
import { scheduler } from "@bluecadet/launchpad/scheduler";
import { refreshPlugin } from "./refresh-plugin.js";

export default defineConfig({
	plugins: [
		content({ versioning: true }),
		refreshPlugin({ downloadPath: ".downloads/" }),
		scheduler({ "refresh.check": "30s" }),
	],
});
