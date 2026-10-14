/**
 * Output strategy: the single seam where the flat and versioned output modes diverge.
 *
 * `resolveOutputStrategy` branches on `config.versioning` exactly once, when the fetch
 * pipeline context is created. Stages consult the resolved strategy for every
 * mode-specific operation (seeding, promotion, retention sweep, backup participation,
 * error cleanup), so adding another output mode means adding one strategy value here
 * rather than re-branching inside each stage.
 */

import { okAsync, ResultAsync } from "neverthrow";
import type { ResolvedContentConfig } from "../content-config.js";
import { ContentError } from "../content-transform.js";
import { type SweepResult, sweepVersions } from "../retention-sweep.js";
import { RUN_LAYOUT } from "../utils/content-layout.js";
import * as FileUtils from "../utils/file-utils.js";
import type { FetchStageContext } from "./fetch-context.js";
import {
	cleanupOrphanedVersion,
	promoteVersioned,
	snapshotVersionedRoots,
} from "./versioned-output.js";

/** Final roots are supplied by the publisher, never reconstructed through a mutable manifest. */
export type PublicationReceipt = { readonly finalRoots: ReadonlyMap<string, string> };
export type PublicationState =
	| { status: "preparing" }
	| { status: "promoting"; orphanedVersionPath: string | undefined }
	| { status: "published"; receipt: PublicationReceipt }
	| { status: "cleaning-backups"; receipt: PublicationReceipt };

export type OutputStrategy = {
	readonly backupsSupported: boolean;
	/** Resolve previous roots exactly once for both seeding and cache lookup. */
	snapshot(
		context: FetchStageContext,
	): ResultAsync<ReadonlyMap<string, string>, FileUtils.FileUtilsError>;
	promote(context: FetchStageContext): ResultAsync<PublicationReceipt, ContentError>;
	sweep(context: FetchStageContext): ResultAsync<SweepResult | undefined, never>;
	cleanupFailedRun(context: FetchStageContext): ResultAsync<void, never>;
};

function promoteStagedSourceDirectory(
	context: FetchStageContext,
	sourceId: string,
): ResultAsync<void, ContentError> {
	const stagedPath = context.paths.getStagedDownloadPath(sourceId);
	const publishedPath = context.paths.getPublishedDownloadPath(sourceId);
	const publishedParentPath = context.paths.getPublishedDownloadPath();
	const rollbackDir = context.paths.getRunPath(RUN_LAYOUT.promotionRollback);

	return FileUtils.pathExists(stagedPath)
		.andThen((exists) => {
			if (!exists) {
				return okAsync(undefined);
			}

			return FileUtils.ensureDir(publishedParentPath).andThen(() =>
				FileUtils.replacePath(stagedPath, publishedPath, {
					preserveTimestamps: true,
					rollbackDir,
				}),
			);
		})
		.mapErr(
			(error) =>
				new ContentError(`Failed to promote staged directory for ${sourceId}`, { cause: error }),
		);
}

function promoteStagedRootEntries(context: FetchStageContext): ResultAsync<void, ContentError> {
	const stagedRoot = context.paths.getStagedDownloadPath();
	const publishedRoot = context.paths.getPublishedDownloadPath();
	const rollbackDir = context.paths.getRunPath(RUN_LAYOUT.promotionRollback);
	const sourceIds = new Set(context.sources.map((source) => source.id));

	return FileUtils.pathExists(stagedRoot)
		.andThen((exists) => {
			if (!exists) {
				return okAsync(undefined);
			}

			return FileUtils.listDir(stagedRoot).andThen((entries) => {
				const rootEntries = entries.filter((entry) => !sourceIds.has(entry));
				if (rootEntries.length === 0) {
					return okAsync(undefined);
				}

				return FileUtils.ensureDir(publishedRoot).andThen(() =>
					ResultAsync.combine(
						rootEntries.map((entry) =>
							FileUtils.replacePath(
								context.paths.getRunPath(RUN_LAYOUT.downloads, entry),
								context.paths.getPublishedDownloadPath(entry),
								{
									preserveTimestamps: true,
									rollbackDir,
								},
							),
						),
					).map(() => undefined),
				);
			});
		})
		.mapErr(
			(error) => new ContentError("Failed to promote staged root-level content", { cause: error }),
		);
}

/**
 * Flat (non-versioned) output: promote staged directories over the published tree,
 * seed from the published tree, rely on the backup/restore pathway for recovery.
 */
const flatOutputStrategy: OutputStrategy = {
	backupsSupported: true,

	snapshot(context) {
		return okAsync(
			new Map(
				context.sources.map((source) => [
					source.id,
					context.paths.getPublishedDownloadPath(source.id),
				]),
			),
		);
	},

	promote(context) {
		return ResultAsync.combine(
			context.sources.map((source) => promoteStagedSourceDirectory(context, source.id)),
		)
			.map(() => undefined)
			.andThen(() => promoteStagedRootEntries(context))
			.map(() => ({
				finalRoots: new Map(
					context.sources.map((source) => [
						source.id,
						context.paths.getPublishedDownloadPath(source.id),
					]),
				),
			}));
	},

	sweep() {
		return okAsync(undefined);
	},

	cleanupFailedRun() {
		return okAsync(undefined);
	},
};

type ResolvedVersioningOptions = Exclude<ResolvedContentConfig["versioning"], false>;

/**
 * Versioned output: promote the whole staged root into `versions/<versionId>/` with an
 * atomic manifest swap, seed from the manifest's active version, sweep retained versions
 * after promotion, and best-effort delete this run's orphaned version dir on failure.
 */
function createVersionedOutputStrategy(versioning: ResolvedVersioningOptions): OutputStrategy {
	return {
		backupsSupported: false,

		snapshot(context) {
			return snapshotVersionedRoots(context);
		},

		promote(context) {
			return promoteVersioned(context);
		},

		sweep(context) {
			return sweepVersions(context.paths.getPublishedDownloadPath(), versioning, context.logger);
		},

		cleanupFailedRun(context) {
			return cleanupOrphanedVersion(context);
		},
	};
}

/**
 * Resolves the output strategy for a fetch run. This is the only place that branches on
 * `config.versioning`.
 */
export function resolveOutputStrategy(config: ResolvedContentConfig): OutputStrategy {
	return config.versioning ? createVersionedOutputStrategy(config.versioning) : flatOutputStrategy;
}
