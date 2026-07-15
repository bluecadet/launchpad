import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

export class FileUtilsError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "FileUtilsError";
	}
}

export function isDir(dirPath: string) {
	return fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
}

export function saveJson(
	json: unknown,
	filePath: string,
	appendJsonExtension = true,
): ResultAsync<void, FileUtilsError> {
	let filePathWithExtension = filePath;
	if (appendJsonExtension && !filePath.endsWith(".json")) {
		filePathWithExtension += ".json";
	}
	const jsonStr = typeof json === "string" ? json : JSON.stringify(json, null, 0);

	return ensureDir(path.dirname(filePathWithExtension)).andThen(() =>
		ResultAsync.fromPromise(
			fs.promises.writeFile(filePathWithExtension, jsonStr),
			(e) => new FileUtilsError(`Could not write file ${filePathWithExtension}`, { cause: e }),
		),
	);
}

/**
 * Removes all files and subdirectories of `dirPath`, except for `exclude`.
 * @param dirPath Any absolute directory path
 * @param exclude Array of glob patterns to exclude (e.g. ['*.json', '** /*.csv', 'my-important-folder/**']). Glob patterns are relative to `dirPath`.
 */
export function removeFilesFromDir(
	dirPath: string,
	exclude: string[] = [],
): ResultAsync<void, FileUtilsError> {
	// Glob expects posix paths
	const globPath = path.resolve(dirPath, "**/*").replaceAll(path.sep, path.posix.sep);
	const excludePaths = exclude.map((pattern) =>
		path.resolve(dirPath, pattern).replaceAll(path.sep, path.posix.sep),
	);

	return ResultAsync.fromPromise(
		glob(globPath, {
			ignore: excludePaths,
			dot: true,
			nodir: true, // Only match files, not directories
		}),
		(error) => new FileUtilsError(`Failed to glob directory ${dirPath}`, { cause: error }),
	)
		.andThen((files) => {
			const deletePromises = files.map((file) =>
				ResultAsync.fromPromise(
					fs.promises.unlink(file), // Use unlink instead of rm to only remove files
					(error) => new FileUtilsError(`Failed to remove ${file}`, { cause: error }),
				),
			);
			return ResultAsync.combine(deletePromises);
		})
		.andThen(() => {
			// Remove empty directories after deleting files
			return ResultAsync.fromPromise(
				glob(globPath, {
					ignore: excludePaths,
					dot: true,
					nodir: false, // Match directories this time
				}),
				(error) => new FileUtilsError(`Failed to glob directories in ${dirPath}`, { cause: error }),
			).andThen((dirs) => {
				// Sort directories by depth (deepest first)
				dirs.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);

				const removeDirPromises = dirs.map(
					(dir) =>
						ResultAsync.fromPromise(
							fs.promises.rmdir(dir),
							(error) => new FileUtilsError(`Failed to remove directory ${dir}`, { cause: error }),
						).orElse(() => okAsync(undefined)), // Ignore errors if directory is not empty
				);
				return ResultAsync.combine(removeDirPromises);
			});
		})
		.map(() => undefined);
}

export function pad(num: number, size: number) {
	return `${num}`.padStart(size, "0");
}

/**
 * Builds a collision-resistant scratch name (for temp/rollback files) by suffixing `prefix`
 * with the process id, a millisecond timestamp, and random characters. Callers join the result
 * to the directory it belongs in.
 */
export function scratchName(prefix: string): string {
	const random = Math.random().toString(36).slice(2, 10);
	return `${prefix}-${process.pid}-${Date.now()}-${random}`;
}

export function removeDirIfEmpty(dirPath: string): ResultAsync<void, FileUtilsError> {
	if (!isDir(dirPath)) {
		return okAsync(undefined);
	}
	return isDirEmpty(dirPath).andThen((isEmpty) => {
		if (isEmpty) {
			return remove(dirPath);
		}
		return okAsync(undefined);
	});
}

export function listDir(dirPath: string): ResultAsync<string[], FileUtilsError> {
	return ResultAsync.fromPromise(
		fs.promises.readdir(dirPath),
		(error) => new FileUtilsError(`Failed to read directory ${dirPath}`, { cause: error }),
	);
}

export function isDirEmpty(dirPath: string): ResultAsync<boolean, FileUtilsError> {
	// @see https://stackoverflow.com/a/39218759/782899
	return ResultAsync.fromPromise(
		fs.promises.readdir(dirPath),
		(e) => new FileUtilsError(`Could not read dir ${dirPath}`, { cause: e }),
	).andThen((files) => okAsync(files.length === 0));
}

/**
 * Ensures that the directory exists. If the directory structure does not exist, it is created.
 */
export function ensureDir(dirPath: string): ResultAsync<void, FileUtilsError> {
	return ResultAsync.fromPromise(
		fs.promises.mkdir(dirPath, { recursive: true }),
		(e) => new FileUtilsError(`Failed to create directory ${dirPath}`, { cause: e }),
	).map(() => undefined); // return void on success
}

/**
 * Removes a file or directory. The directory can have contents. If the path does not exist, silently does nothing.
 * `maxRetries`/`retryDelay` default to 0 (no retry), matching `fs.rm`'s own defaults; pass them
 * explicitly to retry transient locks (e.g. Windows sharing violations) on a multi-pass sweep.
 */
export function remove(
	dir: string,
	options: { maxRetries?: number; retryDelay?: number } = {},
): ResultAsync<void, FileUtilsError> {
	return ResultAsync.fromPromise(
		fs.promises.rm(dir, {
			recursive: true,
			force: true,
			maxRetries: options.maxRetries ?? 0,
			retryDelay: options.retryDelay ?? 0,
		}),
		(e) => new FileUtilsError(`Failed to remove ${dir}`, { cause: e }),
	);
}

/**
 * returns true if the path exists, false otherwise
 */
export function pathExists(dir: string): ResultAsync<boolean, FileUtilsError> {
	return ResultAsync.fromPromise(
		fs.promises
			.access(dir)
			.then(() => true)
			.catch(() => false),
		(e) => new FileUtilsError(`Failed to check if path exists ${dir}`, { cause: e }),
	);
}

/**
 * Copies a file or directory from `src` to `dest`.
 */
export function copy(
	src: string,
	dest: string,
	options = { preserveTimestamps: true },
): ResultAsync<void, FileUtilsError> {
	return ResultAsync.fromPromise(
		fs.promises.stat(src),
		(e) => new FileUtilsError(`Failed to get file stats for ${src}`, { cause: e }),
	)
		.andThrough((stats) => {
			if (stats.isDirectory()) {
				return copyDir(src, dest, options);
			}
			return copyFile(src, dest);
		})
		.andThen((stats) => {
			if (options.preserveTimestamps) {
				return ResultAsync.fromPromise(
					fs.promises.utimes(dest, stats.atime, stats.mtime),
					(e) => new FileUtilsError(`Failed to set file timestamps for ${dest}`, { cause: e }),
				);
			}
			return okAsync(undefined);
		});
}

/**
 * Copies a directory from `src` to `dest`.
 */
function copyDir(
	src: string,
	dest: string,
	options = { preserveTimestamps: true },
): ResultAsync<void, FileUtilsError> {
	return ensureDir(dest)
		.andThen(() =>
			ResultAsync.fromPromise(
				fs.promises.readdir(src),
				(e) => new FileUtilsError(`Failed to read dir ${src}`, { cause: e }),
			),
		)
		.andThen((entries) =>
			ResultAsync.combine(
				entries.map((entry) => copy(path.resolve(src, entry), path.resolve(dest, entry), options)),
			),
		)
		.map(() => undefined);
}

/**
 * Copies a file from `src` to `dest`.
 */
export function copyFile(src: string, dest: string): ResultAsync<void, FileUtilsError> {
	return ensureDir(path.dirname(dest)).andThen(() =>
		ResultAsync.fromPromise(
			fs.promises.copyFile(src, dest),
			(e) => new FileUtilsError(`Failed to copy file ${src} to ${dest}`, { cause: e }),
		),
	);
}

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renames `src` to `dest`, retrying on retryable codes (`EPERM`/`EACCES`/`EBUSY`, e.g. Windows
 * sharing violations) until `retriesRemaining` is exhausted. Non-retryable errors (including
 * `EXDEV`, handled by the caller) fail immediately.
 */
function renameWithRetry(
	src: string,
	dest: string,
	retriesRemaining: number,
	retryDelay: number,
): ResultAsync<void, NodeJS.ErrnoException> {
	return ResultAsync.fromPromise(
		fs.promises.rename(src, dest),
		(error) => error as NodeJS.ErrnoException,
	).orElse((error) => {
		if (retriesRemaining <= 0 || !RETRYABLE_RENAME_CODES.has(error.code ?? "")) {
			return errAsync(error);
		}
		return ResultAsync.fromSafePromise(delay(retryDelay)).andThen(() =>
			renameWithRetry(src, dest, retriesRemaining - 1, retryDelay),
		);
	});
}

/**
 * Atomically replace a file or directory from `src` to `dest` when possible.
 * Falls back to copy + remove when rename cannot be used across devices.
 * `maxRetries`/`retryDelay` default to 0 (no retry), mirroring the documented contract on
 * `remove()`; pass them explicitly to retry the rename step on transient locks (e.g. Windows
 * sharing violations: `EPERM`/`EACCES`/`EBUSY`) before falling back to copy+remove or failing.
 */
export function move(
	src: string,
	dest: string,
	options: {
		preserveTimestamps?: boolean;
		maxRetries?: number;
		retryDelay?: number;
	} = {},
): ResultAsync<void, FileUtilsError> {
	const preserveTimestamps = options.preserveTimestamps ?? true;
	const maxRetries = options.maxRetries ?? 0;
	const retryDelay = options.retryDelay ?? 0;

	return ensureDir(path.dirname(dest)).andThen(() =>
		renameWithRetry(src, dest, maxRetries, retryDelay).orElse((error) => {
			if (error.code !== "EXDEV") {
				return errAsync(new FileUtilsError(`Failed to move ${src} to ${dest}`, { cause: error }));
			}

			return copy(src, dest, { preserveTimestamps }).andThen(() => remove(src));
		}),
	);
}

/**
 * Replaces `dest` with `src` without deleting the published path before the replacement succeeds.
 * If `dest` already exists, it is first moved aside to a rollback path and restored if promotion fails.
 */
export function replacePath(
	src: string,
	dest: string,
	options: {
		preserveTimestamps?: boolean;
		rollbackDir?: string;
	} = {},
): ResultAsync<void, FileUtilsError> {
	const preserveTimestamps = options.preserveTimestamps ?? true;

	return ResultAsync.fromPromise(
		(async () => {
			const sourceExists = await pathExists(src).match(
				(exists) => exists,
				(error) => {
					throw error;
				},
			);

			if (!sourceExists) {
				return;
			}

			const destinationExists = await pathExists(dest).match(
				(exists) => exists,
				(error) => {
					throw error;
				},
			);

			let rollbackPath: string | undefined;

			if (destinationExists) {
				rollbackPath = path.resolve(
					options.rollbackDir ?? path.dirname(dest),
					scratchName(`${path.basename(dest)}.rollback`),
				);

				await remove(rollbackPath).match(
					() => undefined,
					(error) => {
						throw error;
					},
				);
				await move(dest, rollbackPath, { preserveTimestamps }).match(
					() => undefined,
					(error) => {
						throw error;
					},
				);
			}

			try {
				await move(src, dest, { preserveTimestamps }).match(
					() => undefined,
					(error) => {
						throw error;
					},
				);
			} catch (promotionError) {
				if (rollbackPath) {
					await remove(dest).match(
						() => undefined,
						(error) => {
							throw new FileUtilsError(`Failed to clean up partial replacement at ${dest}`, {
								cause: error,
							});
						},
					);
					await move(rollbackPath, dest, { preserveTimestamps }).match(
						() => undefined,
						(error) => {
							throw new FileUtilsError(`Failed to restore ${dest} after promotion error`, {
								cause: error,
							});
						},
					);
				}
				throw promotionError;
			}

			if (rollbackPath) {
				await remove(rollbackPath).match(
					() => undefined,
					(error) => {
						throw error;
					},
				);
			}
		})(),
		(error) =>
			new FileUtilsError(`Failed to replace ${dest} with ${src}`, {
				cause: error,
			}),
	);
}

/**
 * Clear files from a directory.
 * Optionally respects keep patterns and removes empty directories.
 */
export function clearDir(
	dirPath: string,
	options: {
		keepPatterns?: string[];
		ignoreKeep?: boolean;
		removeIfEmpty?: boolean;
	} = {},
): ResultAsync<void, FileUtilsError> {
	return pathExists(dirPath)
		.andThen((exists) => {
			if (!exists) {
				return okAsync(undefined);
			}

			return removeFilesFromDir(dirPath, options.ignoreKeep ? undefined : options.keepPatterns);
		})
		.andThen(() => {
			if (options.removeIfEmpty) {
				return removeDirIfEmpty(dirPath);
			}
			return okAsync(undefined);
		})
		.mapErr((e) => new FileUtilsError(`Failed to clear directory: ${dirPath}`, { cause: e }));
}

/**
 * Clear directories and optionally remove parent if empty.
 */
export function clearDirs(
	dirPaths: string[],
	options: {
		keepPatterns?: string[];
		ignoreKeep?: boolean;
		removeIfEmpty?: boolean;
	} = {},
): ResultAsync<void, FileUtilsError> {
	return ResultAsync.combine(dirPaths.map((dirPath) => clearDir(dirPath, options))).map(
		() => undefined,
	);
}

/**
 * Copies files from `srcDir` to `destDir` that match any of the provided glob patterns.
 * Patterns are evaluated relative to `srcDir`.
 */
export function copyMatchingFiles(
	srcDir: string,
	destDir: string,
	patterns: string[] = [],
): ResultAsync<void, FileUtilsError> {
	if (patterns.length === 0) {
		return okAsync(undefined);
	}

	return pathExists(srcDir).andThen((exists) => {
		if (!exists) {
			return okAsync(undefined);
		}

		const matchesByPattern = patterns.map((pattern) =>
			ResultAsync.fromPromise(
				glob(pattern, {
					cwd: srcDir,
					dot: true,
					nodir: true,
				}),
				(error) =>
					new FileUtilsError(`Failed to glob pattern ${pattern} in ${srcDir}`, { cause: error }),
			),
		);

		return ResultAsync.combine(matchesByPattern).andThen((matches) => {
			const uniqueRelativePaths = new Set(matches.flat());
			return ResultAsync.combine(
				Array.from(uniqueRelativePaths).map((relativePath) =>
					copy(path.resolve(srcDir, relativePath), path.resolve(destDir, relativePath)),
				),
			).map(() => undefined);
		});
	});
}
