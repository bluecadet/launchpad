import fs from "node:fs";
import path from "node:path";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import * as FileUtils from "./utils/file-utils.js";

/** Directory under `downloadPath` holding one ack-lease file per consumer. */
const ACKS_DIRNAME = "acks";

export class AckError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "AckError";
	}
}

/** A bare filename component: no path separators, and not `.`/`..`. */
const SAFE_CONSUMER_ID_PATTERN = /^[^/\\]+$/;

function isValidConsumerId(consumerId: string): boolean {
	return consumerId !== "." && consumerId !== ".." && SAFE_CONSUMER_ID_PATTERN.test(consumerId);
}

const ackBodySchema = z.object({
	versionId: z.string().min(1),
});

/**
 * An ack lease read from `acks/<consumerId>.json`. Freshness is derived from the file's
 * mtime vs `ackTimeout` -- both launchpad and the writing consumer read the same OS clock, so
 * there's no timestamp field in the body to format or drift.
 */
export type AckLease = {
	consumerId: string;
	versionId: string;
	ackedAt: Date;
	fresh: boolean;
};

export function getAcksDirPath(downloadPath: string): string {
	return path.join(downloadPath, ACKS_DIRNAME);
}

export function getAckFilePath(downloadPath: string, consumerId: string): string {
	return path.join(getAcksDirPath(downloadPath), `${consumerId}.json`);
}

function consumerIdFromFilename(filename: string): string {
	return filename.slice(0, -".json".length);
}

function readAckLease(
	acksDir: string,
	filename: string,
	ackTimeout: number,
	logger: Pick<Logger, "warn">,
	now: Date,
): ResultAsync<AckLease | undefined, never> {
	const filePath = path.join(acksDir, filename);

	return ResultAsync.fromPromise(
		Promise.all([fs.promises.readFile(filePath, "utf8"), fs.promises.stat(filePath)]),
		(error) => error,
	)
		.map(([raw, stats]) => {
			let json: unknown;
			try {
				json = JSON.parse(raw);
			} catch {
				logger.warn(`Ignoring unparseable ack lease at ${filePath}: invalid JSON.`);
				return undefined;
			}

			const parsed = ackBodySchema.safeParse(json);
			if (!parsed.success) {
				logger.warn(`Ignoring unparseable ack lease at ${filePath}: ${parsed.error.message}`);
				return undefined;
			}

			return {
				consumerId: consumerIdFromFilename(filename),
				versionId: parsed.data.versionId,
				ackedAt: stats.mtime,
				fresh: now.getTime() - stats.mtime.getTime() <= ackTimeout,
			};
		})
		.orElse((error) => {
			logger.warn(
				`Ignoring unreadable ack lease at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return okAsync(undefined);
		});
}

/**
 * Reads every `acks/<consumerId>.json` lease under `downloadPath`. Never fails: a missing
 * `acks/` directory resolves to an empty list (pure count-based retention), and an
 * unparseable or unreadable lease is dropped with a logged warning rather than aborting the
 * whole read -- the sweep's keep-N backstop still protects retention regardless.
 */
export function readAckLeases(
	downloadPath: string,
	ackTimeout: number,
	logger: Pick<Logger, "warn">,
	now: Date = new Date(),
): ResultAsync<AckLease[], never> {
	const acksDir = getAcksDirPath(downloadPath);

	return FileUtils.pathExists(acksDir)
		.orElse((error) => {
			logger.warn(`Failed to check for acks directory at ${acksDir}: ${error.message}`);
			return okAsync(false);
		})
		.andThen((exists) => {
			if (!exists) {
				return okAsync<AckLease[]>([]);
			}

			return FileUtils.listDir(acksDir)
				.orElse((error) => {
					logger.warn(`Failed to list ack leases at ${acksDir}: ${error.message}`);
					return okAsync<string[]>([]);
				})
				.andThen((filenames) => {
					const jsonFilenames = filenames.filter((filename) => filename.endsWith(".json"));
					return ResultAsync.combine(
						jsonFilenames.map((filename) =>
							readAckLease(acksDir, filename, ackTimeout, logger, now),
						),
					);
				})
				.map((leases) => leases.filter((lease): lease is AckLease => lease !== undefined));
		});
}

/**
 * Writes (or renews) the ack lease at `acks/<consumerId>.json`, creating `acks/` on demand.
 * Renewal is just a rewrite -- the file's mtime, which is all `readAckLeases` looks at for
 * freshness, is bumped by the write itself.
 */
export function writeAckLease(
	downloadPath: string,
	consumerId: string,
	versionId: string,
): ResultAsync<void, AckError> {
	if (!isValidConsumerId(consumerId)) {
		return errAsync(new AckError(`Invalid consumerId: "${consumerId}"`));
	}

	return FileUtils.ensureDir(getAcksDirPath(downloadPath))
		.mapErr((error) => new AckError("Failed to create acks directory", { cause: error }))
		.andThen(() =>
			ResultAsync.fromPromise(
				fs.promises.writeFile(
					getAckFilePath(downloadPath, consumerId),
					JSON.stringify({ versionId }),
				),
				(error) => new AckError(`Failed to write ack lease for "${consumerId}"`, { cause: error }),
			),
		);
}
