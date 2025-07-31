import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import chalk from "chalk";
import { createJiti } from "jiti";

const DEFAULT_CONFIG_PATHS = [
	"launchpad.config.js",
	"launchpad.config.mjs",
	"launchpad.config.ts",
	"launchpad.config.cjs",
	"launchpad.config.mts",
	"launchpad.config.cts",
];

/**
 * Searches for all config files in the current and parent directories, up to a max depth of 64.
 * @returns {string[]} Array of absolute paths to the config files found.
 */
export function findConfig() {
	const configs = findAllConfigsRecursive();
	if (configs.length > 0) {
		console.log(`Found configs: ${configs.map((c) => chalk.white(c)).join(", ")}`);
	}
	return configs.length > 0 ? configs[0] : null;
}

/**
 * Searches for all config files in the current and parent directories, up to a max depth of 64.
 * @returns {string[]} Array of absolute paths to the config files found.
 */
function findAllConfigsRecursive() {
	const maxDepth = 64;
	const foundConfigs = [];
	let currentDir = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();

	for (let i = 0; i < maxDepth; i++) {
		for (const defaultPath of DEFAULT_CONFIG_PATHS) {
			const candidatePath = path.resolve(currentDir, defaultPath);
			if (fs.existsSync(candidatePath)) {
				foundConfigs.push(candidatePath);
			}
		}

		const parentDir = path.resolve(currentDir, "..");
		if (currentDir === parentDir) {
			// Can't navigate any more levels up
			break;
		}

		currentDir = parentDir;
	}

	return foundConfigs;
}

export async function loadConfigFromFile<T>(configPath: string): Promise<Partial<T>> {
	if (!configPath) {
		return {};
	}

	const jiti = createJiti(import.meta.url);

	try {
		// need to use fileURLToPath here for windows support (prefixes with file://)
		const fileUrl = url.pathToFileURL(configPath);
		return await jiti.import(fileUrl.toString(), { default: true });
	} catch (err) {
		throw new Error(`Unable to load config file '${chalk.white(configPath)}'`, { cause: err });
	}
}
