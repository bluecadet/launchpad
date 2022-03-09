#!/usr/bin/env node

import { LaunchpadMonitor } from './lib/launchpad-monitor.js';
import { launchFromCli, onExit } from '@bluecadet/launchpad-utils';

// export * from './lib/windows-api.js'; // Includes optional dependencies, so not exported here
export * from './lib/launchpad-monitor.js';
export * from './lib/monitor-options.js';
export default LaunchpadMonitor;

export const launch = async (config) => {
  const monitor = new LaunchpadMonitor(config.monitor || config);
  await monitor.connect();
  await monitor.start();
  
  onExit(async () => {
    await monitor.stop();
    await monitor.disconnect();
  });
}

launchFromCli(import.meta).then(launch).catch(err => {
  if (err) {
    console.error('Launch error', err);
    process.exit(1);
  }
});
