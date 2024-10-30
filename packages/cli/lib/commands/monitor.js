import { ResultAsync } from 'neverthrow';
import { ImportError, MonitorError } from '../errors.js';
import { loadConfigAndEnv } from '../utils/load-config-and-env.js';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 */
export function monitor(argv) {
	return loadConfigAndEnv(argv).andThen(config => {
		return importLaunchpadMonitor()
			.map(({ LaunchpadMonitor }) => {
				return new LaunchpadMonitor(config.monitor);
			})
			.andThrough((monitorInstance) => {
				return ResultAsync.fromPromise(monitorInstance.connect(), () => new MonitorError('Failed to connect to monitor'));
			})
			.andThrough((monitorInstance) => {
				return ResultAsync.fromPromise(monitorInstance.start(), () => new MonitorError('Failed to start monitor'));
			});
	}).mapErr(error => {
		console.error('Monitor failed to start.');
		console.error(error.message);
		process.exit(1);
	});
}

export function importLaunchpadMonitor() {
	return ResultAsync.fromPromise(
		import('@bluecadet/launchpad-monitor'),
		() => new ImportError('Could not find module "@bluecadet/launchpad-monitor". Make sure you have installed it.')
	);
}
