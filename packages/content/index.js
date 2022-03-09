#!/usr/bin/env node

import { LaunchpadContent } from './lib/launchpad-content.js';
import { launchFromCli } from '@bluecadet/launchpad-utils';

export * from './lib/content-options.js';
export * from './lib/launchpad-content.js';
export default LaunchpadContent;

export const launch = async (config) => {
  const content = new LaunchpadContent(config.content || config);
  await content.start(); 
};

launchFromCli(import.meta).then(launch).catch(err => {
  if (err) {
    console.error('Launch error', err);
    process.exit(1);
  }
});
