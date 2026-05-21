import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import chalk from "chalk";
import { createJiti } from "jiti";
import { cliLogger } from "./cli-logger.js";

const CONFIG_FILE_NAMES = [
	"launchpad.config.js",
	"launchpad.config.mjs",
	"launchpad.config.ts",
	"launchpad.config.cjs",
	"launchpad.config.mts",
	"launchpad.config.cts",
];

/**
 * Searches for config file in the current and parent directories, up to a max depth of 64.
 * @returns {string | null} Absolute path to the first config file found, or null if none are found.
 */
export function findFirstConfigRecursive(): string | null {
	const maxDepth = 64;
	let currentDir = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();

	for (let i = 0; i < maxDepth; i++) {
		for (const filename of CONFIG_FILE_NAMES) {
			const candidatePath = path.resolve(currentDir, filename);
			if (fs.existsSync(candidatePath)) {
				cliLogger.info(`Found config: ${chalk.gray(candidatePath)}`);
				return candidatePath;
			}
		}

		const parentDir = path.resolve(currentDir, "..");
		if (currentDir === parentDir) {
			// Can't navigate any more levels up
			break;
		}

		currentDir = parentDir;
	}

	return null;
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
