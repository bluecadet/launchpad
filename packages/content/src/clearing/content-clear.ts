import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ContentActionContext } from "../content-action-context.js";
import { ContentError } from "../content-transform.js";
import { closeRunCache, markCacheUntrusted, openRunCache } from "../fetching/cache-lifecycle.js";
import * as FileUtils from "../utils/file-utils.js";
import { createPathsHelper, isSafeSourceId, type PathsHelper } from "../utils/paths-helper.js";
import { buildClearPlan, type ClearOptions } from "./clear-plan.js";

async function invalidateForClear(
	sourceIds: string[],
	paths: PathsHelper,
	ctx: ContentActionContext,
): Promise<void> {
	const cache = await openRunCache(
		ctx.cwd,
		ctx.logger,
		() => undefined,
		paths.getStagedDownloadPath,
	);
	try {
		await cache.invalidate(sourceIds);
	} catch (error) {
		ctx.logger.warn("Could not invalidate cache metadata; marking project cache untrusted", error);
		await markCacheUntrusted(ctx.cwd);
	} finally {
		await closeRunCache(cache, ctx.logger);
	}
}

/** The command owns a project lease; this module owns its validated clear transaction. */
export function clearContent(
	sourceIds: string[] | string | null,
	{ temp = false, backups = false, downloads = true, cache = false }: Partial<ClearOptions>,
	ctx: ContentActionContext,
): ResultAsync<void, Error> {
	const selected = typeof sourceIds === "string" ? [sourceIds] : sourceIds;
	const ids = selected ?? [...ctx.sourceRegistry.keys()];
	if (ids.length === 0) return okAsync(undefined);
	if (ids.some((sourceId) => !isSafeSourceId(sourceId))) {
		return errAsync(new ContentError("Clear source IDs must be directory names, not paths"));
	}
	if (ids.some((sourceId) => !ctx.sourceRegistry.has(sourceId))) {
		return errAsync(new ContentError("Cannot clear an unregistered source"));
	}
	const paths = createPathsHelper(ctx.resolvedConfig, ctx.cwd);
	return ResultAsync.fromPromise(
		buildClearPlan(
			ids,
			selected === null,
			{ temp, backups, downloads, cache },
			paths,
			ctx.resolvedConfig,
			ctx.cwd,
		),
		(error) => new ContentError("Failed to resolve safe clear paths", { cause: error }),
	)
		.andThen((plan) =>
			ResultAsync.fromPromise(
				plan.invalidateMetadata ? invalidateForClear(ids, paths, ctx) : Promise.resolve(),
				(error) =>
					new ContentError("Cannot safely invalidate artifact cache before clearing", {
						cause: error,
					}),
			)
				.andThen(() =>
					ResultAsync.combine(
						plan.directories.map((directory) =>
							FileUtils.clearDir(directory, { removeIfEmpty: true }),
						),
					),
				)
				.andThen(() => ResultAsync.combine(plan.emptyParents.map(FileUtils.removeDirIfEmpty)))
				.map(() => undefined),
		)
		.mapErr((error) => new ContentError("Failed to clear directories", { cause: error }));
}
