#!/usr/bin/env node

import * as sudo from 'sudo-prompt';
import { LogManager } from '@bluecadet/launchpad-utils';
import * as path from 'path';

/**
 * @param {import('@bluecadet/launchpad-utils').Logger} [parentLogger]
 */
export function launchScaffold(parentLogger) {
	if (!parentLogger) {
		LogManager.configureRootLogger();
	}

	const logger = LogManager.getLogger('scaffold', parentLogger);

	if (process.platform !== 'win32') {
		logger.error('Launchpad Scaffold currently only supports Windows');
		logger.error('Exiting...');
		process.exit(1);
	}

	logger.info('Starting Launchpad Scaffold script...');

	return sudo.exec(`start ${path.resolve(import.meta.dirname, './setup.bat')}`, {
		name: 'Launchpad Scaffold'
	},
	function(error, stdout, stderr) {
		if (error) throw error;
		console.log(stdout);
	});
}
