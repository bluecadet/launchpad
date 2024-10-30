import { ResultAsync } from 'neverthrow';
import { ImportError } from '../errors.js';
import { loadConfigAndEnv } from '../utils/load-config-and-env.js';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 */
export function content(argv) {
	return loadConfigAndEnv(argv).andThen(config => {
		return importLaunchpadContent().map(({ LaunchpadContent }) => {
			const contentInstance = new LaunchpadContent(config.content);
			return contentInstance.download();
		});
	}).mapErr(error => {
		console.error('Content failed to download.');
		console.error(error.message);
		process.exit(1);
	});
}

export function importLaunchpadContent() {
	return ResultAsync.fromPromise(
		import('@bluecadet/launchpad-content'),
		() => new ImportError('Could not find module "@bluecadet/launchpad-content". Make sure you have installed it.')
	);
}
