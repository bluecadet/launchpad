import { launchFromCli, ConfigManager } from '@bluecadet/launchpad-utils';
import LaunchpadMonitor from '../lib/launchpad-monitor.js';
import chalk from 'chalk';

const getConfig = async (paths = ['user-config.js', 'config.js']) => {
	return ConfigManager.importJsConfig(paths, import.meta);
};

// @see https://stackoverflow.com/questions/19687407/press-any-key-to-continue-in-nodejs
const keypress = async () => {
	process.stdin.setRawMode(true);
	return new Promise(resolve => process.stdin.once('data', data => {
		const byteArray = [...data];
		if (byteArray.length > 0 && byteArray[0] === 3) {
			console.log('^C');
			process.exit(1);
		}
		process.stdin.setRawMode(false);
		console.log(chalk.bgMagenta('\nManual shut down triggered\n'));
		resolve();
	}));
};

launchFromCli(import.meta, {
	userConfig: await getConfig()
}).then(async config => {
	const monitor = await LaunchpadMonitor.createAndStart(config.monitor || config);
	const appNames = monitor.getAllAppNames();

	// await Promise.all([...appNames, 'fake-app'].map(async (appName) => {
	// 	const isRunning = await monitor.isRunning(appName);
	// 	console.log(`App '${appName}' is running: ${isRunning}`);
	// 	return isRunning;
	// }));
	
	console.log(chalk.bgCyan('\nPress any key to shut down...\n'));
	await keypress();

	await monitor.stop();

	// await Promise.all([...appNames, 'fake-app'].map(async (appName) => {
	// 	const isRunning = await monitor.isRunning(appName);
	// 	console.log(`App '${appName}' is running: ${isRunning}`);
	// 	return isRunning;
	// }));

	await monitor.disconnect();
	process.exit(0);
}).catch(err => {
	if (err) {
		console.error('Launch error', err);
		process.exit(1);
	}
});

export { getConfig };
