import path from "node:path";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { readManifest } from "./manifest.js";

export type RefetchCheckCommand = {
	type: "refetch.check";
};

const refetchCheckCommandSchema = z
	.object({
		type: z.literal("refetch.check"),
	})
	.strict();

export type RefetchCheckResult = {
	/** Freshness value reported by `getLatestModifiedAt` for this check. */
	modifiedAt: string;
	/** Whether the check dispatched a `content.fetch`. */
	fetched: boolean;
};

export type RefetchCheckerOptions = {
	/**
	 * CMS-specific freshness probe. Return the most recent modification value the CMS
	 * reports, in a format whose lexicographic order matches chronological order
	 * (e.g. an ISO 8601 timestamp).
	 */
	getLatestModifiedAt: (helpers: { abortSignal: AbortSignal; logger: Logger }) => Promise<string>;
	/**
	 * Where to read the active version manifest used as the baseline for the first check
	 * after boot. Defaults to discovering the content plugin's published manifest by
	 * dispatching `content.manifest.read`; set this only when the manifest lives somewhere
	 * the content plugin doesn't manage. Relative paths resolve against the launchpad cwd.
	 */
	downloadPath?: string;
};

/** The slice of a `content.manifest.read` result the checker needs. */
const promotedManifestSchema = z.object({
	status: z.literal("ok"),
	manifest: z.object({ generatedAt: z.string() }),
});

/**
 * Baseline for the first check after boot: the active manifest's `generatedAt`, or
 * `undefined` when there is no readable manifest — the caller then fetches
 * unconditionally, covering fresh installs and self-healing a failed boot fetch.
 */
function readBaseline(
	ctx: PluginContext,
	downloadPath: string | undefined,
): ResultAsync<string | undefined, never> {
	if (downloadPath !== undefined) {
		return ResultAsync.fromSafePromise(readManifest(path.resolve(ctx.cwd, downloadPath))).map(
			(result) => (result.status === "ok" ? result.manifest.generatedAt : undefined),
		);
	}

	return ctx
		.dispatchCommand({ type: "content.manifest.read" })
		.map((result) => {
			const parsed = promotedManifestSchema.safeParse(result);
			return parsed.success ? parsed.data.manifest.generatedAt : undefined;
		})
		.orElse(() => okAsync(undefined));
}

function check(
	ctx: PluginContext,
	options: RefetchCheckerOptions,
	getLastSeen: () => string | undefined,
	setLastSeen: (value: string) => void,
): ResultAsync<RefetchCheckResult, Error> {
	return ResultAsync.fromPromise(
		options.getLatestModifiedAt({ abortSignal: ctx.abortSignal, logger: ctx.logger }),
		ensureError,
	).andThen((modifiedAt) => {
		const lastSeen = getLastSeen();
		const baseline =
			lastSeen !== undefined ? okAsync(lastSeen) : readBaseline(ctx, options.downloadPath);

		return baseline.andThen((baselineValue) => {
			if (baselineValue !== undefined && modifiedAt <= baselineValue) {
				setLastSeen(modifiedAt);
				return okAsync({ modifiedAt, fetched: false });
			}

			// Awaited inline so scheduler intervals cover the whole check-and-fetch cycle and a
			// failed fetch fails the run. lastSeen stays unset on failure, so the retry re-fetches.
			return ctx.dispatchCommand({ type: "content.fetch" }).map(() => {
				setLastSeen(modifiedAt);
				return { modifiedAt, fetched: true };
			});
		});
	});
}

/**
 * Creates a check-before-fetch plugin: its `refetch.check` command asks the CMS for its
 * latest modification value via `getLatestModifiedAt` and dispatches `content.fetch` only
 * when that value is newer than the last one seen, so a fast schedule doesn't mint a new
 * content version (and reload every polling app) on every cycle.
 *
 * Pair it with the content plugin (with `versioning` enabled) and schedule the check,
 * e.g. `scheduler({ "refetch.check": "30s" })`. Without versioning there is no manifest,
 * so only the in-memory baseline applies and the first check after boot always fetches.
 */
export function refetchChecker(options: RefetchCheckerOptions) {
	return definePlugin({
		name: "refetch-checker",
		manifest: {
			commands: [
				{
					id: "refetch.check",
					description: "Dispatch content.fetch only when the CMS reports newer content",
					parser: refetchCheckCommandSchema,
				},
			],
		},
		setup(ctx: PluginContext) {
			let lastSeen: string | undefined;

			return okAsync({
				executeCommand(command: RefetchCheckCommand): ResultAsync<unknown, Error> {
					const parsed = refetchCheckCommandSchema.safeParse(command);
					if (!parsed.success) {
						return errAsync(new Error(`Invalid command: ${parsed.error.message}`));
					}

					return check(
						ctx,
						options,
						() => lastSeen,
						(value) => {
							lastSeen = value;
						},
					);
				},
			});
		},
	});
}
