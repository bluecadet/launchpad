#!/usr/bin/env node

import { LaunchpadCore } from './lib/launchpad-core.js';
import { launchFromCli, onExit } from '@bluecadet/launchpad-utils';

export * as content from '@bluecadet/launchpad-content';
export * as dashboard from '@bluecadet/launchpad-dashboard';
export * as monitor from '@bluecadet/launchpad-monitor';
export * as utils from '@bluecadet/launchpad-utils';

export * from './lib/launchpad-core.js';
export * from './lib/launchpad-options.js';
export default LaunchpadCore;

export const launch = async (config) => {
  const launchpad = new LaunchpadCore(config);
	await launchpad.startup();
  
  onExit(async () => {
    await launchpad.shutdown();
  });
}

launchFromCli(import.meta, {
	relativePath: 'core/index.js'
}).then(launch).catch(err => {
	if (err) {
		console.error('Launch error', err);
		process.exit(1);
	}
});
