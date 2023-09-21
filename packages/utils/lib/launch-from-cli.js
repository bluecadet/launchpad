import url from 'url';

import { findConfig, loadConfigFromFile } from './config.js';
import LogManager from './log-manager.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { resolveEnv } from './env.js';
import path from 'path';

/**
 * Resolves with a promise including the current config if your
 * script was called directly. If it was included in another script, this
 * function will return a rejected promise with no error.
 * 
 * @template {{logging?: import('./log-manager.js').LogOptions}} T config type
 * @param {ImportMeta} importMeta Pass the import.meta property from your script here
 * @param {object} [options]
 * @param {object} [options.userConfig] Optional user config to be merged with the loaded config
 * @param {string|Array<string>} [options.relativePaths] Optional paths to detect if this script was loaded as a dependency or directly. This can help with detecting if linked packages were run directly.
 * @param {(function(import('yargs').Argv) : import('yargs').Argv)} [options.yargsCallback] Optional function to further configure yargs startup options.
 * @returns {Promise<any>} A promise with the current config.
 */
export const launchFromCli = async (importMeta, {
	userConfig,
	relativePaths,
	yargsCallback
} = {}) => {
	// Ensure relativePaths is an array
	if (!relativePaths) {
		relativePaths = [];
	} else if (!Array.isArray(relativePaths)) {
		relativePaths = [relativePaths];
	}
	
	if (!isMain(importMeta, relativePaths)) {
		// eslint-disable-next-line prefer-promise-reject-errors
		return Promise.reject();
	}

	let argv = yargs(hideBin(process.argv))
		.parserConfiguration({
		// See https://github.com/yargs/yargs-parser#camel-case-expansion
			'camel-case-expansion': false
		})
		.option('config', { alias: 'c', describe: 'Path to your JS or JSON config file', type: 'string' })
		.option('env', { alias: 'e', describe: 'Path(s) to your .env file(s)', type: 'array' })
		.option('env-cascade', { alias: 'E', describe: 'cascade env variables from `.env`, `.env.<arg>`, `.env.local`, `.env.<arg>.local` in launchpad root dir', type: 'string' })
		.help();

	if (yargsCallback) {
		argv = yargsCallback(argv);
	}
		
	const parsedArgv = await argv.parse();

	const configPath = parsedArgv.config ?? findConfig();

	if (!configPath) {
		throw new Error('No config file found.');
	}
	
	const configDir = path.dirname(configPath);

	// load env before config, so that env variables can be used in config
	if (parsedArgv.env) {
		// if env arg is passed, resolve paths relative to the CWD
		const rootDir = process.env.INIT_CWD ?? '';

		resolveEnv(
			parsedArgv.env.map(p => path.resolve(rootDir, p.toString()))
		);
	} else if (parsedArgv['env-cascade']) {
		// if env-cascade arg is passed, resolve paths relative to the config file

		// Load order: .env < .env.[override] < .env.local < .env.[override].local
		
		resolveEnv([
			path.resolve(configDir, '.env'),
			path.resolve(configDir, `.env.${parsedArgv['env-cascade']}`),
			path.resolve(configDir, '.env.local'),
			path.resolve(configDir, `.env.${parsedArgv['env-cascade']}.local`)
		]);
	} else {
		// default to loading .env and .env.local in the config dir

		resolveEnv([
			path.resolve(configDir, '.env'),
			path.resolve(configDir, '.env.local')
		]);
	}
	
	/**
	 * @type {Partial<T>}
	*/
	const config = {
		// Loads the config in the following order of overrides:
		// js/json < user < cli args
		...(await loadConfigFromFile(configPath)),
		...userConfig,
		...parsedArgv
	};

	LogManager.getInstance(config.logging);
	
	return Promise.resolve(config);
};

/**
 * 
 * @param {ImportMeta} importMeta 
 * @param {Array<string>} relativePaths 
 * @returns {boolean}
 */
const isMain = (importMeta, relativePaths) => {
	/** @type {string} */
	const metaUrl = importMeta.url;
	/** @type {string} */
	const processUrl = url.pathToFileURL(process.argv[1]).href;
	return (metaUrl === processUrl) || relativePaths.some(p => processUrl.endsWith(p));
};

export default launchFromCli;
