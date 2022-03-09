import { exec } from 'child_process';

/**
 * Executes a scripts and pipes output and error to a logger
 * @param {string} script 
 * @param {string} cwd 
 * @param {*} logger 
 * @returns 
 */
export const execScript = async (script, cwd, logger = console) => {
	logger.debug(`execScript: '${script}'`);
	return new Promise((resolve, reject) => {
		const child = exec(script, {
			cwd: cwd
		});
		child.stdout.on('data', (data) => {
			logger.info(data);
		});
		child.stderr.on('data', (data) => {
			logger.error(data);
		});
		child.on('error', (err) => {
			logger.error(`Couldn't run script ${script}: ${err}`);
			reject(err);
		});
		child.on('close', (code) => {
			logger.debug(code);
			resolve(code);
		});
	});
}

export default execScript;