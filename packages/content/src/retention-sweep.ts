import fs from "node:fs";
import path from "node:path";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { okAsync, ResultAsync } from "neverthrow";
import { type AckLease, readAckLeases } from "./acks.js";
import * as ManifestUtils from "./manifest.js";
import * as FileUtils from "./utils/file-utils.js";

/** Directory under `downloadPath` holding one dir per minted version. */
const VERSIONS_DIRNAME = "versions";

export const REMOVE_MAX_RETRIES = 3;
export const REMOVE_RETRY_DELAY_MS = 100;

/**
 * Temp-manifest files older than this are treated as crash debris and reaped by the sweep. A
 * conservative hour is far longer than any legitimate write-then-rename window, so a temp file
 * this old can only be the residue of a crash between `writeManifest`'s temp write and rename.
 */
const STALE_TEMP_MANIFEST_AGE_MS = 60 * 60 * 1000;

export type SweepResult = {
	/** Manifest's current version when a valid manifest was available during the sweep. */
	activeVersion?: {
		versionId: string;
		promotedAt: Date;
	};
	retainedVersionIds: string[];
	deletedVersionIds: string[];
	pendingDeleteVersionIds: string[];
	acks: AckLease[];
};

export function getVersionsDirPath(downloadPath: string): string {
	return path.join(downloadPath, VERSIONS_DIRNAME);
}

function listVersionDirs(versionsDir: string): ResultAsync<string[], never> {
	return FileUtils.listDir(versionsDir)
		.map((entries) => entries.filter((entry) => FileUtils.isDir(path.join(versionsDir, entry))))
		.orElse(() => okAsync<string[]>([]));
}

/**
 * Best-effort reap of stale temp-manifest scratch files left in `downloadPath` by a crash
 * between `writeManifest`'s temp write and rename. `writeManifest` cleans up its own temp on a
 * handled failure, so anything still here older than `STALE_TEMP_MANIFEST_AGE_MS` is crash
 * debris. Never fails the sweep: an unreadable entry or a failed delete is logged and skipped.
 */
function reapStaleTempManifests(
	downloadPath: string,
	logger: Pick<Logger, "warn">,
	now: Date,
): ResultAsync<void, never> {
	return FileUtils.listDir(downloadPath)
		.orElse(() => okAsync<string[]>([]))
		.andThen((entries) => {
			const tempManifests = entries.filter((entry) =>
				entry.startsWith(ManifestUtils.MANIFEST_TEMP_PREFIX),
			);

			return ResultAsync.combine(
				tempManifests.map((entry) => {
					const filePath = path.join(downloadPath, entry);
					return ResultAsync.fromPromise(fs.promises.stat(filePath), (error) => error)
						.andThen((stats) => {
							if (now.getTime() - stats.mtime.getTime() < STALE_TEMP_MANIFEST_AGE_MS) {
								return okAsync(undefined);
							}
							return FileUtils.remove(filePath).orElse((error) => {
								logger.warn(`Failed to reap stale temp manifest ${filePath}: ${error.message}`);
								return okAsync(undefined);
							});
						})
						.orElse(() => okAsync(undefined));
				}),
			).map(() => undefined);
		});
}

function readActiveVersion(downloadPath: string): ResultAsync<SweepResult["activeVersion"], never> {
	return ResultAsync.fromSafePromise(ManifestUtils.readManifest(downloadPath)).map((result) =>
		result.status === "ok"
			? {
					versionId: result.manifest.versionId,
					promotedAt: new Date(result.manifest.generatedAt),
				}
			: undefined,
	);
}

/**
 * Runs the keep-N retention sweep for versioned output. The retention set is the `keepVersions`
 * newest version dirs by name (lexical sort equals chronological order, since version ids
 * are UTC timestamps) union the manifest's active version union any versionId named by a
 * fresh ack lease. Everything else under `versions/` is deleted.
 *
 * Deletion is best-effort and idempotent: a dir that fails to fully delete (e.g. a locked
 * file on Windows) is left in place and reported as pending-delete. The retention set is
 * re-derived from scratch on every call, so a pending-delete dir is simply reconsidered next
 * sweep -- no separate orphan tracking is needed, crash debris ages out under the same rule.
 */
export function sweepVersions(
	downloadPath: string,
	retention: { keepVersions: number; ackTimeout: number },
	logger: Pick<Logger, "warn">,
	now: Date = new Date(),
): ResultAsync<SweepResult, never> {
	const versionsDir = getVersionsDirPath(downloadPath);

	// Acks are snapshotted once here, then versions are deleted below. An ack written for an
	// out-of-keep-N version *between* this read and its deletion is missed and the version is
	// swept. This TOCTOU window is bounded and by design: keep-N is the hard retention rule, and
	// a version lost this way is re-established by the next fetch, so a consumer re-acks then.
	return reapStaleTempManifests(downloadPath, logger, now).andThen(() =>
		readAckLeases(downloadPath, retention.ackTimeout, logger, now).andThen((acks) =>
			FileUtils.pathExists(versionsDir)
				.orElse((error) => {
					logger.warn(`Failed to check for versions directory at ${versionsDir}: ${error.message}`);
					return okAsync(false);
				})
				.andThen((versionsDirExists) => {
					if (!versionsDirExists) {
						return okAsync<SweepResult>({
							retainedVersionIds: [],
							deletedVersionIds: [],
							pendingDeleteVersionIds: [],
							acks,
						});
					}

					return listVersionDirs(versionsDir).andThen((versionIds) =>
						readActiveVersion(downloadPath).andThen((activeVersion) => {
							const sortedIds = [...versionIds].sort();
							const newestKept =
								retention.keepVersions > 0 ? sortedIds.slice(-retention.keepVersions) : [];
							const retentionSet = new Set(newestKept);

							if (activeVersion) {
								retentionSet.add(activeVersion.versionId);
							}
							for (const ack of acks) {
								if (ack.fresh) {
									retentionSet.add(ack.versionId);
								}
							}

							const retainedVersionIds = sortedIds.filter((versionId) =>
								retentionSet.has(versionId),
							);
							const candidateVersionIds = sortedIds.filter(
								(versionId) => !retentionSet.has(versionId),
							);

							return ResultAsync.combine(
								candidateVersionIds.map((versionId) =>
									FileUtils.remove(path.join(versionsDir, versionId), {
										maxRetries: REMOVE_MAX_RETRIES,
										retryDelay: REMOVE_RETRY_DELAY_MS,
									})
										.map(() => ({ versionId, deleted: true as const }))
										.orElse((error) => {
											logger.warn(
												`Failed to remove version directory ${versionId} during retention sweep, will retry next sweep: ${error.message}`,
											);
											return okAsync({ versionId, deleted: false as const });
										}),
								),
							).map((outcomes) => ({
								...(activeVersion ? { activeVersion } : {}),
								retainedVersionIds,
								deletedVersionIds: outcomes
									.filter((outcome) => outcome.deleted)
									.map((outcome) => outcome.versionId),
								pendingDeleteVersionIds: outcomes
									.filter((outcome) => !outcome.deleted)
									.map((outcome) => outcome.versionId),
								acks,
							}));
						}),
					);
				}),
		),
	);
}
