import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs-extra';
import path from 'path';
import url from 'url';
import stripJsonComments from 'strip-json-comments';
import chalk from 'chalk';

export class ConfigManagerOptions {
	static DEFAULT_CONFIG_PATHS = ['launchpad.json', 'config.json'];
	
	constructor({
		configPaths = ConfigManagerOptions.DEFAULT_CONFIG_PATHS,
		...rest
	} = {}) {
		
		/**
		 * The path where to load the config from.
		 * If an array of paths is passed, all found configs will be merged in that order.
		 * @type {string|Array<string>} 
		 */
		this.configPaths = configPaths;
		
    // Allows for additional properties to be inherited
		Object.assign(this, rest);
	}
}

export class ConfigManager {
	/** @type {ConfigManager} */
	static _instance = null;
	
	/** @returns {ConfigManager} */
	static getInstance() {
		if (this._instance === null) {
			this._instance = new ConfigManager();
		}
		return this._instance;
	}
	
	/** @type {ConfigManagerOptions} */
	_config = new ConfigManagerOptions();
	
	/** @type {boolean} */
	_isLoaded = false;
	
	static getProcessDirname(importMeta) {
		return importMeta ? path.dirname(url.fileURLToPath(importMeta.url)) : '';
	}
	
	/**
	 * Imports a JS config from a set of paths. The JS files have to export
	 * its config as the default export. Will return the first config found.
	 * @param {Array.<string>} paths 
	 * @param {*} importMeta The import.meta property of the file at your base directory.
	 * @returns {*} The parsed config object or null if none can be found
	 */
	static async importJsConfig(paths, importMeta = null) {
		const __dirname = ConfigManager.getProcessDirname(importMeta);
		for (const configPath of paths) {
			const fileUrl = url.pathToFileURL(path.join(__dirname, configPath));
			try {
				if (fs.existsSync(fileUrl)) {
					console.log(`Importing JS config from ${fileUrl}`);
					return (await import(fileUrl)).default;
				}
			} catch (err) {
				console.warn(`Could not import JS config from ${fileUrl}`, err);
			}
		}
		return null;
	}
	
	constructor() {
	}
	
	/**
	 * Loads the config in the following order of overrides:
	 *   defaults < json < user < argv 
	 * 
	 * @param {ConfigManagerOptions|Object} userConfig Optional config overrides
	 * @param {function(yargs.Argv) : yargsObj.Argv} yargsCallback Optional function to further configure yargs startup options.
 	 * @returns {Promise<*, *>} A promise with the current config.
	 * @returns {Object}
	 */
	loadConfig(userConfig = null, yargsCallback = null) {
		if (userConfig) {
			this._config = {...this._config, ...userConfig};
		}
		
		let argv = yargs(hideBin(process.argv))
			.parserConfiguration({
				"camel-case-expansion": false,
				"unknown-options-as-args": true
			})
			.config('config', 'Path to your config file. Can contain comments.', this._loadConfigFromFile.bind(this));
		
		if (yargsCallback) {
			argv = yargsCallback(argv);
		}
		
		const parsedArgv = argv.help().parse();
		
		this._config = {...this._config, ...parsedArgv};
		
		if (!parsedArgv.config) {
			for (const configPath of this._config.configPaths) {
				this._config = {...this._config, ...this._loadConfigFromFile(configPath)};
			}
		}
		
		this._isLoaded = true;
		return this._config;
	}
	
	/**
	 * Retrieves the current config object.
	 * @returns {ConfigManagerOptions}
	 */
	getConfig() {
		return this._config;
	}
	
	/**
	 * @param {string} key 
	 * @returns @type {boolean} true if the key exists in the config
	 */
	has(key) {
		return key in this._config;
	}
	
	/**
	 * @returns @type {boolean} true when loadConfig() has been called successfully.
	 */
	isLoaded() {
		return this._isLoaded;
	}
	
	_loadConfigFromFile(configPath) {
		if (!configPath) {
			return {};
		}
		
		let absPath = configPath;
		
		if (process.env.INIT_CWD && !fs.existsSync(configPath)) {
			absPath = path.resolve(process.env.INIT_CWD, configPath);
		}
		
		try {
			const maxLevels = 64;
			for (let i = 0; i < maxLevels; i++) {
				const resolvedPath = path.resolve(absPath);
				
				// console.debug(chalk.gray(`Trying to load config from ${chalk.white(resolvedPath)}`));
				
				if (fs.existsSync(resolvedPath)) {
					absPath = resolvedPath;
					console.info(chalk.gray(`Loading config from ${chalk.white(absPath)}`));
					break;
					
				} else if (i >= maxLevels) {
					throw new Error(`No config found at '${chalk.white(configPath)}'.`);
					
				} else {
					const dirPath = path.dirname(absPath);
					const filePath = path.basename(absPath);
					const parentPath = path.resolve(dirPath, `..`, filePath);
					
					if (absPath === parentPath) {
						// Can't navigate any more levels up
						throw new Error(`No config found at '${chalk.white(configPath)}'.`);
					}
					
					absPath = parentPath;
				}
			}
			
			const configStr = fs.readFileSync(absPath, 'utf8');
			const config = JSON.parse(stripJsonComments(configStr));
			
			if (!config) {
				throw new Error(`Could not parse config from '${chalk.white(configPath)}'`);
			}
			
			return config;
			
		} catch (err) {
			console.warn(`${err.message}`);
		}

    return {};
	}
}

export default ConfigManager;