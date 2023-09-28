import fsx from 'fs-extra';
import chalk from 'chalk';
import { Logger } from '@bluecadet/launchpad-utils';

/**
 * @type {Record<string, unknown>}
 */
let creds = {};

/**
 * @deprecated Use .env for managing sensitive data instead
 */
class Credentials {
	/** @type {Logger | Console} */
	static logger = console;
  
	/**
	 * @param {string} [credentialsPath] 
	 * @param {Logger | Console} logger 
 	 * @deprecated Use .env for managing sensitive data instead
	 */
	static init(credentialsPath, logger = console) {
		this.logger = logger;

		if (!credentialsPath) {
			return;
		}

		this.logger.warn(`${chalk.white('credentialsPath')} option is deprecated. Please use ${chalk.white('.env')}/${chalk.white('.env.local')} instead.`);

		try {
			if (fsx.existsSync(credentialsPath)) {
				this.logger.info(chalk.gray(`Loading credentials from '${chalk.white(credentialsPath)}'`));
				const rawdata = fsx.readFileSync(credentialsPath);
				creds = JSON.parse(rawdata.toString());
			} else {
				this.logger.warn(`No credentials file found at '${credentialsPath}'`);
			}
		} catch (err) {
			if (err instanceof Error) {
				this.logger.error(`Couldn't load credentials from '${chalk.white(credentialsPath)}'`, err.message);
			}
		}
	}
  
	/**
	 * @param {string} id
	 * @deprecated Use .env for managing sensitive data instead
	 */
	static getCredentials(id) {
		if (id in creds) {
			return creds[id];
		} else {
			this.logger.error(`Can't find credentials for '${id}'`);
			return null;
		}
	}
}

export default Credentials;
