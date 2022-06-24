import Launchpad from '../index.js';
import { launchFromCli } from '@bluecadet/launchpad-utils';
import { default as testConfig } from './config.js';

const wait = async (seconds) => {
	console.debug(`Waiting for ${seconds}s...`);
	return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

launchFromCli(import.meta, {
	userConfig: testConfig
}).then(async config => {
	const launchpad = new Launchpad(config);
	
	await launchpad.startup();
	
	const appNames = launchpad._monitor.getAllAppNames();
	await Promise.all([...appNames, 'fake-app'].map(async (appName) => {
		const isRunning = await launchpad._monitor.isRunning(appName);
		console.debug(`App '${appName}' is running: ${isRunning}`);
	}));
	
	await wait(10);
	await launchpad.updateContent();
	
	await wait(10);
	await launchpad.shutdown();
	
}).catch(err => {
	if (err) {
		console.error('Launch error', err);
		throw err;
	}
});