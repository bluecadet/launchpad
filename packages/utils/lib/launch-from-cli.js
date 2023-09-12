import url from 'url';

import ConfigManager from './config-manager.js';
import LogManager from './log-manager.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/**
 * Resolves with a promise including the current config if your
 * script was called directly. If it was included in another script, this
 * function will return a rejected promise with no error.
 * 
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
		.option('config', { alias: 'c', describe: 'Path to your JS or JSON config file.', type: 'string' }).help();

	if (yargsCallback) {
		argv = yargsCallback(argv);
	}

	const parsedArgv = await argv.parse();

	const configManager = new ConfigManager();
	
	await configManager.loadConfig(userConfig, parsedArgv.config);
	/** @type {any} TODO: figure out where to add this 'logging' property */
	const config = configManager.getConfig();
	LogManager.getInstance(config.logging || config);
	
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
