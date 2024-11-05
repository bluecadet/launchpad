import LaunchpadMonitor from '@bluecadet/launchpad-monitor';
import { LogManager } from '@bluecadet/launchpad-utils';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 */
export async function stop(argv) {
	const logger = LogManager.configureRootLogger();
	await LaunchpadMonitor.kill(logger);
}
