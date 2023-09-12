import fs from 'fs-extra';
import path from 'path';
import url from 'url';
import stripJsonComments from 'strip-json-comments';
import chalk from 'chalk';

const DEFAULT_CONFIG_PATHS = ['launchpad.config.js', 'launchpad.config.mjs', 'launchpad.json', 'config.json'];

export class ConfigManager {
	/** @type {ConfigManager | null} */
	static _instance = null;
	
	/** @returns {ConfigManager} */
	static getInstance() {
		if (this._instance === null) {
			this._instance = new ConfigManager();
		}
		return this._instance;
	}
	
	/** @type {object} */
	_config = {};
	
	/** @type {boolean} */
	_isLoaded = false;
	
	/**
	 * 
	 * @param {ImportMeta?} importMeta 
	 * @returns 
	 */
	static getProcessDirname(importMeta) {
		return importMeta ? path.dirname(url.fileURLToPath(importMeta.url)) : '';
	}
	
	/**
	 * Imports a JS config from a set of paths. The JS files have to export
	 * its config as the default export. Will return the first config found.
	 * @param {Array<string>} paths 
	 * @param {ImportMeta?} importMeta The import.meta property of the file at your base directory.
	 * @returns {Promise<object | null>} The parsed config object or null if none can be found
	 */
	static async importJsConfig(paths, importMeta = null) {
		const __dirname = ConfigManager.getProcessDirname(importMeta);
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
	 * Loads the config in the following order of overrides:
	 *   defaults < js/json < user 
	 * 
	 * @param {object?} userConfig Optional config overrides
	 * @param {string} [configPath] Optional path to a config file, relative to the current working directory.
 	 * @returns {Promise<object>} A promise with the current config.
	 */
	async loadConfig(userConfig = null, configPath) {
		if (configPath) {
			// if config is manually specified, load it without searching parent directories,
			// and fail if it doesn't exist
			const resolved = path.resolve(configPath);
			if (!fs.existsSync(resolved)) {
				throw new Error(`Could not find config at '${resolved}'`);
			}

			this._config = { ...this._config, ...ConfigManager._loadConfigFromFile(resolved) };
		} else {
			// if no config is specified, search current and parent directories for default config files.
			// Only the first found config will be loaded.
			for (const defaultPath of DEFAULT_CONFIG_PATHS) {
				const resolved = ConfigManager._fileExistsRecursive(defaultPath);
				
				if (resolved) {
					console.warn(`Found config at '${chalk.white(resolved)}'`);
					this._config = { ...this._config, ...(await ConfigManager._loadConfigFromFile(resolved)) };
					break;
				}
				
				console.warn(`Could not find config with name '${chalk.white(defaultPath)}'`);
			}
		}

		// user config overrides js/json config
		if (userConfig) {
			this._config = { ...this._config, ...userConfig };
		}
		
		this._isLoaded = true;
		return this._config;
	}
	
	/**
	 * Retrieves the current config object.
	 * @returns {object}
	 */
	getConfig() {
		return this._config;
	}
	
	/**
	 * @param {string} key 
	 * @returns {boolean} true if the key exists in the config
	 */
	has(key) {
		return key in this._config;
	}
	
	/**
	 * @returns {boolean} true when loadConfig() has been called successfully.
	 */
	isLoaded() {
		return this._isLoaded;
	}

	/**
	 * @param {string} filePath
	 * @returns {string | null} The absolute path to the file or null if it doesn't exist.
	 * @private
	 */
	static _fileExistsRecursive(filePath) {
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
	 * @param {string} configPath 
	 * @private
	 */
	static async _loadConfigFromFile(configPath) {
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
				return (await import(configPath)).default;
			}
		} catch (err) {
			throw new Error(`Unable to load config file '${chalk.white(configPath)}'`, { cause: err });
		}
	}
}

export default ConfigManager;
