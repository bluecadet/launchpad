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
