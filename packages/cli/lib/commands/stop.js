import LaunchpadMonitor from '@bluecadet/launchpad-monitor';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 */
export async function stop(argv) {
	await LaunchpadMonitor.kill();
}
