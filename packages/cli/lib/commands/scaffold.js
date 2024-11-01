import { launchScaffold } from '@bluecadet/launchpad-scaffold';
import { LogManager } from '@bluecadet/launchpad-utils';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 */
export async function scaffold(argv) {
	const rootLogger = LogManager.configureRootLogger();
	await launchScaffold(rootLogger);
}
