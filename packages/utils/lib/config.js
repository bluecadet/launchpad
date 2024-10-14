import fs from 'fs-extra';
import path from 'path';
import url from 'url';
import stripJsonComments from 'strip-json-comments';
import chalk from 'chalk';

const DEFAULT_CONFIG_PATHS = ['launchpad.config.js', 'launchpad.config.mjs', 'launchpad.json', 'config.json'];

/**
 * @typedef BaseConfig
 * @property {import('./log-manager.js').LogOptions} [logging]
 */

/**
 * 
 * @param {ImportMeta?} importMeta 
 * @returns 
 */
function getProcessDirname(importMeta) {
	return importMeta ? path.dirname(url.fileURLToPath(importMeta.url)) : '';
}
	
/**
 * Imports a JS config from a set of paths. The JS files have to export
 * its config as the default export. Will return the first config found.
 * @template {BaseConfig} T config type
 * @param {Array<string>} paths 
 * @param {ImportMeta?} importMeta The import.meta property of the file at your base directory.
 * @returns {Promise<Partial<T> | null>} The parsed config object or null if none can be found
 */
export async function importJsConfig(paths, importMeta = null) {
	const __dirname = getProcessDirname(importMeta);
	for (const configPath of paths) {
		const fileUrl = url.pathToFileURL(path.join(__dirname, configPath));
		try {
			if (fs.existsSync(fileUrl)) {
				console.log(`Importing JS config from ${fileUrl}`);
				return (await import(fileUrl.toString())).default;
			}
		} catch (err) {
			console.warn(`Could not import JS config from ${fileUrl}`, err);
		}
	}
	return null;
}

/**
 * Searches for a config file in the current and parent directories, up to a max depth of 64.
 * @returns {string | null} Absolute path to the config file or null if none can be found.
 */
export function findConfig() {
	for (const defaultPath of DEFAULT_CONFIG_PATHS) {
		const resolved = findFirstFileRecursive(defaultPath);
		
		if (resolved) {
			console.log(`Found config '${chalk.white(resolved)}'`);
			return resolved;
		}
		
		console.warn(`Could not find config with name '${chalk.white(defaultPath)}'`);
	}

	return null;
}

/**
 * Searches for a file in the current and parent directories, up to a max depth of 64.
 * @param {string} filePath
 * @returns {string | null} The absolute path to the file or null if it doesn't exist.
 */
function findFirstFileRecursive(filePath) {
	const maxDepth = 64;

	let absPath = filePath;

	if (process.env.INIT_CWD) {
		absPath = path.resolve(process.env.INIT_CWD, filePath);
	} else {
		absPath = path.resolve(filePath);
	}

	for (let i = 0; i < maxDepth; i++) {
		if (fs.existsSync(absPath)) {
			return absPath;
		}
		
		const dirPath = path.dirname(absPath);
		const filePath = path.basename(absPath);
		const parentPath = path.resolve(dirPath, '..', filePath);

		if (absPath === parentPath) {
			// Can't navigate any more levels up
			break;
		}

		absPath = parentPath;
	}

	return null;
}

/**
 * @template T
 * @param {string} configPath 
 * @returns {Promise<Partial<T>>}
 */
export async function loadConfigFromFile(configPath) {
	if (!configPath) {
		return {};
	}
	
	try {
		// if suffix is json, parse as json
		if (configPath.endsWith('.json')) {
			console.warn(chalk.yellow('JSON config files are deprecated. Please use JS config files instead.'));

			const configStr = fs.readFileSync(configPath, 'utf8');
			const config = JSON.parse(stripJsonComments(configStr));
	
			if (!config) {
				throw new Error(`Could not parse config from '${chalk.white(configPath)}'`);
			}

			return config;
		} else {
			// otherwise, parse as js

			// need to use fileURLToPath here for windows support (prefixes with file://)
			const fileUrl = url.pathToFileURL(configPath);
			return (await import(fileUrl.toString())).default;
		}
	} catch (err) {
		throw new Error(`Unable to load config file '${chalk.white(configPath)}'`, { cause: err });
	}
}
