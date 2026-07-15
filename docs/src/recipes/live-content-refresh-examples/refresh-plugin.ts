import { readFile } from "node:fs/promises";
import path from "node:path";
import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

type RefreshCheckCommand = { type: "refresh.check" };

type RefreshPluginOptions = {
	downloadPath: string;
};

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

async function readManifestGeneratedAt(downloadPath: string): Promise<string | undefined> {
	try {
		const raw = await readFile(path.join(downloadPath, "manifest.json"), "utf8");
		const manifest: unknown = JSON.parse(raw);
		if (
			typeof manifest === "object" &&
			manifest !== null &&
			"generatedAt" in manifest &&
			typeof manifest.generatedAt === "string"
		) {
			return manifest.generatedAt;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

// Replace this with a CMS-specific request for its most recent modifiedAt value.
declare function getCmsModifiedAt(): Promise<string>;

export function refreshPlugin({ downloadPath }: RefreshPluginOptions) {
	let lastSeen: string | undefined;

	return definePlugin({
		name: "refresh",
		manifest: {
			commands: [{ id: "refresh.check" }],
		},
		setup(ctx) {
			return okAsync({
				executeCommand(command: RefreshCheckCommand) {
					if (command.type !== "refresh.check") {
						return errAsync(new Error(`Unsupported command: ${command.type}`));
					}

					return ResultAsync.fromPromise(
						checkForNewContent(
							ctx,
							downloadPath,
							() => lastSeen,
							(value) => {
								lastSeen = value;
							},
						),
						asError,
					);
				},
			});
		},
	});
}

async function checkForNewContent(
	ctx: PluginContext,
	downloadPath: string,
	getLastSeen: () => string | undefined,
	setLastSeen: (modifiedAt: string) => void,
): Promise<void> {
	const modifiedAt = await getCmsModifiedAt();
	const baseline = getLastSeen() ?? (await readManifestGeneratedAt(downloadPath));

	if (baseline === undefined || modifiedAt > baseline) {
		const result = await ctx.dispatchCommand({ type: "content.fetch" });
		if (result.isErr()) {
			throw result.error;
		}
	}

	setLastSeen(modifiedAt);
}
