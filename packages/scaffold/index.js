#!/usr/bin/env node

import * as sudo from 'sudo-prompt';
import { launchFromCli, LogManager } from '@bluecadet/launchpad-utils';
import * as path from 'path';
import * as url from 'url';

export class LaunchpadScaffold {
	constructor({
		filepath = './setup.bat'
	} = {}) {
		this.filepath = filepath;
		this._logger = LogManager.getInstance().getLogger('scaffold');
	}

	async start() {
		return new Promise((resolve, reject) => {
			// @see https://stackoverflow.com/a/50052194/782899
			const dir = path.dirname(url.fileURLToPath(import.meta.url));
			this._logger.info('Starting Launchpad Scaffold script...');
			sudo.exec(`start ${path.resolve(dir, this.filepath)}`, {
				name: 'Launchpad Scaffold'
			}, (error, stdout) => {
				if (error) {
					reject(error);
				} else {
					console.log(stdout);
					resolve();
				}
			});
		});
	}
}

export const launch = async (config) => {
	const scaffold = new LaunchpadScaffold(config.scaffold || config);
	await scaffold.start();
};

launchFromCli(import.meta, {
	relativePaths: ['launchpad-scaffold/index.js', '.bin/launchpad-scaffold']
})
	.then(launch)
	.catch((err) => {
		if (err) {
			console.error('Launch error', err);
			process.exit(1);
		}
	});
