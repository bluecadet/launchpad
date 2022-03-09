import fsx from 'fs-extra';
import chalk from 'chalk';

let creds = {};

class Credentials {
  static logger = console;
  
  static init(credentialsPath, logger = console) {
    this.logger = logger;
    try {
      if (credentialsPath && fsx.existsSync(credentialsPath)) {
        this.logger.info(chalk.gray(`Loading credentials from '${chalk.white(credentialsPath)}'`));
        const rawdata = fsx.readFileSync(credentialsPath);
        creds = JSON.parse(rawdata);
      } else if (credentialsPath) {
        this.logger.warn(`No credentials file found at '${credentialsPath}'`);
      } else {
        this.logger.warn(chalk.yellow(`No credentials path specified`));
      }
    } catch (err) {
      this.logger.error(`Couldn't load credentials from '${chalk.white(credentialsPath)}'`, err.message);
    }
  }
  
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
