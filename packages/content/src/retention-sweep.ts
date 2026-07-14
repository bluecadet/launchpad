import path from "node:path";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { okAsync, ResultAsync } from "neverthrow";
import { type AckLease, readAckLeases } from "./acks.js";
import * as ManifestUtils from "./manifest.js";
import * as FileUtils from "./utils/file-utils.js";

/** Directory under `downloadPath` holding one dir per minted version. */
export const VERSIONS_DIRNAME = "versions";

const REMOVE_MAX_RETRIES = 3;
const REMOVE_RETRY_DELAY_MS = 100;

export type SweepResult = {
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

function readActiveVersionId(downloadPath: string): ResultAsync<string | undefined, never> {
	return ResultAsync.fromSafePromise(ManifestUtils.readManifest(downloadPath)).map((result) =>
		result.status === "ok" ? result.manifest.versionId : undefined,
	);
}

/**
 * Runs the keep-N retention sweep for versioned output. The retention set is the `keep`
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
	retention: { keep: number; ackTimeout: number },
	logger: Pick<Logger, "warn">,
	now: Date = new Date(),
): ResultAsync<SweepResult, never> {
	const versionsDir = getVersionsDirPath(downloadPath);

	return readAckLeases(downloadPath, retention.ackTimeout, logger, now).andThen((acks) =>
		FileUtils.pathExists(versionsDir).andThen((versionsDirExists) => {
			if (!versionsDirExists) {
				return okAsync<SweepResult>({
					retainedVersionIds: [],
					deletedVersionIds: [],
					pendingDeleteVersionIds: [],
					acks,
				});
			}

			return listVersionDirs(versionsDir).andThen((versionIds) =>
				readActiveVersionId(downloadPath).andThen((activeVersionId) => {
					const sortedIds = [...versionIds].sort();
					const newestKept = retention.keep > 0 ? sortedIds.slice(-retention.keep) : [];
					const retentionSet = new Set(newestKept);

					if (activeVersionId) {
						retentionSet.add(activeVersionId);
					}
					for (const ack of acks) {
						if (ack.fresh) {
							retentionSet.add(ack.versionId);
						}
					}

					const retainedVersionIds = sortedIds.filter((versionId) => retentionSet.has(versionId));
					const candidateVersionIds = sortedIds.filter((versionId) => !retentionSet.has(versionId));

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
	);
}
