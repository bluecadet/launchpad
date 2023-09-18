import fsx from 'fs-extra';
import chalk from 'chalk';
import { Logger } from '@bluecadet/launchpad-utils';

/**
 * @type {any}
 */
let creds = {};

class Credentials {
	/** @type {Logger | Console} */
	static logger = console;
  
	/**
	 * @param {string} credentialsPath 
	 * @param {Logger | Console} logger 
	 */
	static init(credentialsPath, logger = console) {
		this.logger = logger;
		try {
			if (credentialsPath && fsx.existsSync(credentialsPath)) {
				this.logger.info(chalk.gray(`Loading credentials from '${chalk.white(credentialsPath)}'`));
				const rawdata = fsx.readFileSync(credentialsPath);
				creds = JSON.parse(rawdata.toString());
			} else if (credentialsPath) {
				this.logger.warn(`No credentials file found at '${credentialsPath}'`);
			} else {
				this.logger.warn(chalk.yellow('No credentials path specified'));
			}
		} catch (err) {
			if (err instanceof Error) {
				this.logger.error(`Couldn't load credentials from '${chalk.white(credentialsPath)}'`, err.message);
			}
		}
	}
  
	/**
	 * @param {string} id
	 */
	static getCredentials(id) {
		if (id in creds) {
			return creds[id];
		} else {
			this.logger.error(`Can't find credentials for '${id}'`);
			return {};
		}
	}
}

export default Credentials;
