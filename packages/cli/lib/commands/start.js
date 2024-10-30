import { loadConfigAndEnv } from '../utils/load-config-and-env.js';
import { importLaunchpadMonitor } from './monitor.js';
import { importLaunchpadContent } from './content.js';
import { ResultAsync } from 'neverthrow';
import { MonitorError } from '../errors.js';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 */
export async function start(argv) {
	return loadConfigAndEnv(argv).andThen(config => {
		return importLaunchpadContent().map(({ LaunchpadContent }) => {
			const contentInstance = new LaunchpadContent(config.content);
			return contentInstance.start();
		}).andThen(() => importLaunchpadMonitor())
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
		console.error('Launchpad failed to start.');
		console.error(error.message);
		process.exit(1);
	});
}
