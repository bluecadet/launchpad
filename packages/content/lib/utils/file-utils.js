import path from 'path';
import fs from 'fs';
import {glob} from 'glob';
import { okAsync, ResultAsync } from 'neverthrow';

/**
 * @param {string} dirPath
 */
export function isDir(dirPath) {
	return fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory();
}

/**
 * 
 * @param {unknown} json 
 * @param {string} filePath 
 * @param {boolean} appendJsonExtension
 * @returns {ResultAsync<void, string>}
 */
export function saveJson(json, filePath, appendJsonExtension = true) {
	if (appendJsonExtension && !(filePath + '').endsWith('.json')) {
		filePath += '.json';
	}
	const jsonStr = (typeof json === 'string') ? json : JSON.stringify(json, null, 0);

	return ensureDir(path.dirname(filePath))
		.andThen(() => ResultAsync.fromPromise(fs.promises.writeFile(filePath, jsonStr), (_) => `Could not write file ${filePath}`));
}
    
/**
 * Removes all files and subdirectories of `dirPath`, except for `exclude`.
 * @param {string} dirPath Any absolute directory path
 * @param {string[]} [exclude] Array of glob patterns to exclude (e.g. ['*.json', '** /*.csv', 'my-important-folder/**']). Glob patterns are relative to `dirPath`.
 * @returns {ResultAsync<void, string>}
 */
export function removeFilesFromDir(dirPath, exclude = []) {
  return ResultAsync.fromPromise(
    glob(path.join(dirPath, '**/*'), { 
      ignore: exclude.map(pattern => path.join(dirPath, pattern)), 
      dot: true,
      nodir: true // Only match files, not directories
    }),
    (error) => `Failed to glob directory ${dirPath}: ${error}`
  )
  .andThen((files) => {
    const deletePromises = files.map((file) => 
      ResultAsync.fromPromise(
        fs.promises.unlink(file), // Use unlink instead of rm to only remove files
        (error) => `Failed to remove ${file}: ${error}`
      )
    );
    return ResultAsync.combine(deletePromises);
  })
  .andThen(() => {
    // Remove empty directories after deleting files
    return ResultAsync.fromPromise(
      glob(path.join(dirPath, '**/*'), { 
        ignore: exclude, 
        dot: true,
        nodir: false // Match directories this time
      }),
      (error) => `Failed to glob directories in ${dirPath}: ${error}`
    )
    .andThen((dirs) => {
      // Sort directories by depth (deepest first)
      dirs.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
      
      const removeDirPromises = dirs.map((dir) =>
        ResultAsync.fromPromise(
          fs.promises.rmdir(dir),
          (error) => `Failed to remove directory ${dir}: ${error}`
        ).orElse(() => okAsync(undefined)) // Ignore errors if directory is not empty
      );
      return ResultAsync.combine(removeDirPromises);
    });
  })
  .map(() => undefined);
}
    
export function getDateString(d = new Date()) {
	const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate() + 1, 2)}`;
	const timeStr = `${pad(d.getHours(), 2)}-${pad(d.getMinutes(), 2)}-${pad(d.getSeconds(), 2)}`;
	return `${dateStr}_${timeStr}`;
}

/**
 * @param {number} num
 * @param {number} size
 */
export function pad(num, size) {
	let s = num + '';
	while (s.length < size) s = '0' + s;
	return s;
}
    
/**
 * @param {string} dirPath
 * @returns {ResultAsync<void, string>}
 */
export function removeDirIfEmpty(dirPath) {
	if (!isDir(dirPath)) {
		return okAsync(undefined);
	}
	return isDirEmpty(dirPath).andThen(isEmpty => {
		if (isEmpty) {
			return remove(dirPath);
		}
		return okAsync(undefined);
	});
}
	
/**
 * @param {string} dirPath
 * @returns {ResultAsync<boolean, string>}
 */
export function isDirEmpty(dirPath) {
	// @see https://stackoverflow.com/a/39218759/782899
	return ResultAsync.fromPromise(fs.promises.readdir(dirPath), (_) => `Could not read dir ${dirPath}`)
		.andThen(files => okAsync(files.length === 0));
}

/**
 * Ensures that the directory exists. If the directory structure does not exist, it is created.
 * @param {string} dirPath 
 * @returns {ResultAsync<void, string>}
 */
export function ensureDir(dirPath) {
	return ResultAsync.fromPromise(
		fs.promises.mkdir(dirPath, { recursive: true }),
		wrapError(`Failed to create directory ${dirPath}`)
	).map(() => undefined); // return void on success
}

/**
 * Removes a file or directory. The directory can have contents. If the path does not exist, silently does nothing.
 * @param {string} dir 
 * @returns {ResultAsync<void, string>}
 */
export function remove(dir) {
	return ResultAsync.fromPromise(
		fs.promises.rm(dir, { recursive: true, force: true }),
		wrapError(`Failed to remove ${dir}`)
	);
}

/**
 * returns true if the path exists, false otherwise
 * @param {string} dir 
 * @returns {ResultAsync<boolean, string>}
 */
export function pathExists(dir) {
	return ResultAsync.fromPromise(
		fs.promises.access(dir).then(() => true).catch(() => false),
		wrapError(`Failed to check if path exists ${dir}`)
	);
}

/**
 * Copies a file or directory from `src` to `dest`.
 * @param {string} src
 * @param {string} dest
 * @param {object} [options]
 * @param {boolean} [options.preserveTimestamps]
 * @returns {ResultAsync<void, string>}
 */
export function copy(src, dest, options = { preserveTimestamps: true }) {
	return ResultAsync.fromPromise(
		fs.promises.stat(src),
		wrapError(`Failed to get file stats for ${src}`)
	).andThrough((stats) => {
		if (stats.isDirectory()) {
			return copyDir(src, dest, options);
		} else {
			return copyFile(src, dest);
		}
	}).andThen((stats) => {
		if (options.preserveTimestamps) {
			return ResultAsync.fromPromise(fs.promises.utimes(dest, stats.atime, stats.mtime), wrapError(`Failed to set file timestamps for ${dest}`));
		}
		return okAsync(undefined);
	});
}

/**
 * Copies a directory from `src` to `dest`.
 * @param {string} src
 * @param {string} dest
 * @param {object} [options]
 * @param {boolean} [options.preserveTimestamps]
 * @returns {ResultAsync<void, string>}
 */
function copyDir(src, dest, options = { preserveTimestamps: true }) {
	return ensureDir(dest)
		.andThen(() => ResultAsync.fromPromise(fs.promises.readdir(src), wrapError(`Failed to read dir ${src}`)))
		.andThen((entries) =>
			ResultAsync.combine(entries.map((entry) =>
				copy(path.join(src, entry), path.join(dest, entry), options)
			))
		).map(() => undefined);
}

/**
 * Copies a file from `src` to `dest`.
 * @param {string} src
 * @param {string} dest
 * @returns {ResultAsync<void, string>}
 */
function copyFile(src, dest) {
	return ResultAsync.fromPromise(
		fs.promises.copyFile(src, dest),
		wrapError(`Failed to copy file ${src} to ${dest}`)
	);
}

const wrapError = (/** @type string */ message) => (/** @type unknown */ error) => {
	return (error instanceof Error) ? `${message}: ${error.message}` : `${message}: ${error}`;
};
