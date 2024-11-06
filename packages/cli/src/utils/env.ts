import dotenv from 'dotenv';
import fs from 'node:fs';
import chalk from 'chalk';

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
			path: envFilePath
		});
    
		console.log(`Loaded env file '${chalk.white(envFilePath)}'`);
	}
}
