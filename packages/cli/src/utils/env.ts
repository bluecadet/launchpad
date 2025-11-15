import fs from "node:fs";
import chalk from "chalk";
import dotenv from "dotenv";
import { cliLogger } from "./cli-logger.js";

/**
 * Load env files from paths into process.env
 * @param {string[]} paths
 */
export function resolveEnv(paths: string[]) {
	for (const envFilePath of paths) {
		// check if file exists at path
		if (!fs.existsSync(envFilePath)) {
			continue;
		}

		// load env file
		dotenv.config({
			path: envFilePath,
		});

		cliLogger.info(`Loaded env file '${chalk.white(envFilePath)}'`);
	}
}
