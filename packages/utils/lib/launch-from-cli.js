import url from 'url';
import yargs from 'yargs';

import ConfigManager from './config-manager.js';
import LogManager from './log-manager.js';

/**
 * Resolves with a promise including the current config if your
 * script was called directly. If it was included in another script, this
 * function will return a rejected promise with no error.
 * 
 * @param {*} importMeta Pass the import.meta property from your script here
 * @param {Object} userConfig Optional user config to be merged with the loaded config
 * @param {string|Array<string>} relativePaths Optional paths to detect if this script was loaded as a dependency or directly. This can help with detecting if linked packages were run directly.
 * @param {function(yargs.Argv) : yargs.Argv} yargsCallback Optional function to further configure yargs startup options.
 * @returns {Promise<*, *>} A promise with the current config.
 */
export const launchFromCli = async (importMeta, {
	userConfig = null,
	relativePaths = null,
	yargsCallback = null
} = {}) => {
	
	// Ensure relativePaths is an array
	if (!relativePaths) {
		relativePaths = [];
	} else if (!Array.isArray(relativePaths)) {
		relativePaths = [relativePaths];
	}
	
	if (!isMain(importMeta, relativePaths)) {
		return Promise.reject();
	}
	
	ConfigManager.getInstance().loadConfig(userConfig, yargsCallback);
	const config = ConfigManager.getInstance().getConfig();
	LogManager.getInstance(config.logging || config);
	
	return Promise.resolve(config);
};

/**
 * 
 * @param {*} importMeta 
 * @param {Array<string>} relativePaths 
 * @returns {boolean}
 */
const isMain = (importMeta, relativePaths) => {
	/** @type {string} */
	const metaUrl = importMeta.url;
	/** @type {string} */
	const processUrl = url.pathToFileURL(process.argv[1]).href;
	return (metaUrl === processUrl)
	  || relativePaths.some(p => processUrl.endsWith(p));
}

export default launchFromCli;
