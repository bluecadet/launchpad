import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { okAsync, ResultAsync } from "neverthrow";

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
 */
export function remove(dir: string): ResultAsync<void, FileUtilsError> {
	return ResultAsync.fromPromise(
		fs.promises.rm(dir, { recursive: true, force: true }),
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
export function copyDir(
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
	return ResultAsync.fromPromise(
		fs.promises.copyFile(src, dest),
		(e) => new FileUtilsError(`Failed to copy file ${src} to ${dest}`, { cause: e }),
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
