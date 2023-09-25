import { launchFromCli, importJsConfig } from '@bluecadet/launchpad-utils';
import LaunchpadContent from '../lib/launchpad-content.js';

const getConfig = async (paths = ['user-config.js', 'config.js']) => {
	return importJsConfig(paths, import.meta);
};

launchFromCli(import.meta, {
	userConfig: await getConfig()
}).then(async config => {
	const content = new LaunchpadContent(config.monitor || config);
	await content.start();
	// await content.clear();
	process.exit(0);
}).catch(err => {
	if (err) {
		console.error('Launch error', err);
		process.exit(1);
	}
});

export { getConfig };
