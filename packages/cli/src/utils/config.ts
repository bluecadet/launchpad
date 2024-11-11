import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import chalk from "chalk";

const DEFAULT_CONFIG_PATHS = [
	"launchpad.config.js",
	"launchpad.config.mjs",
	"launchpad.json",
	"config.json",
];

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
 * @returns The absolute path to the file or null if it doesn't exist.
 */
function findFirstFileRecursive(filePath: string) {
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
		const parentPath = path.resolve(dirPath, "..", filePath);

		if (absPath === parentPath) {
			// Can't navigate any more levels up
			break;
		}

		absPath = parentPath;
	}

	return null;
}

export async function loadConfigFromFile<T>(configPath: string): Promise<Partial<T>> {
	if (!configPath) {
		return {};
	}

	try {
		// need to use fileURLToPath here for windows support (prefixes with file://)
		const fileUrl = url.pathToFileURL(configPath);
		return (await import(fileUrl.toString())).default;
	} catch (err) {
		throw new Error(`Unable to load config file '${chalk.white(configPath)}'`, { cause: err });
	}
}
