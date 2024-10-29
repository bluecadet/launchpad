import { launchScaffold } from '@bluecadet/launchpad-scaffold';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 */
export async function scaffold(argv) {
	await launchScaffold();
}
