#!/usr/bin/env node

import { LaunchpadContent } from './lib/launchpad-content.js';
import { launchFromCli } from '@bluecadet/launchpad-utils';

export * from './lib/content-options.js';
export * from './lib/launchpad-content.js';
export * from './lib/utils/file-utils.js';
export default LaunchpadContent;

/**
 * @param {import('./lib/content-options.js').ContentOptions | {content: import('./lib/content-options.js').ContentOptions}} config
 */
export const launch = async (config) => {
	const content = new LaunchpadContent('content' in config ? config.content : config);
	await content.start();
};

launchFromCli(import.meta, {
	relativePaths: ['launchpad-content/index.js', '.bin/launchpad-content']
})
	.then(launch)
	.catch((err) => {
		if (err) {
			console.error('Launch error', err);
			process.exit(1);
		}
	});
