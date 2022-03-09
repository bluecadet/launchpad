#!/usr/bin/env node

import { launch as launchContent } from '@bluecadet/launchpad-content';
import { launch as launchCore, LaunchpadCore } from '@bluecadet/launchpad-core';
import { launch as launchMonitor, LaunchpadMonitor } from '@bluecadet/launchpad-monitor';
import { launch as launchScaffold } from '@bluecadet/launchpad-scaffold';
import { launchFromCli, onExit } from '@bluecadet/launchpad-utils';

export class StartupCommands {
	/** @type {string} */
	static START = 'start';
	/** @type {string} */
	static STOP = 'stop';
	/** @type {string} */
	static CONTENT = 'content';
	/** @type {string} */
	static MONITOR = 'monitor';
	/** @type {string} */
	static SCAFFOLD = 'scaffold';
}

const addCommand = (argv, commands, description) => {
	if (!Array.isArray(commands)) {
		commands = [commands];
	}
	argv.command(commands, description, () => {}, args => {
		args.startupCommand = commands[0];
	});
	return argv;
};

// Launched as standalone module
launchFromCli(import.meta, {
	relativePaths: ['launchpad/index.js', '.bin/launchpad'],
	yargsCallback: argv => {
		argv = addCommand(argv, [StartupCommands.START, '$0'], 'Starts launchpad by updating content and starting apps.');
		argv = addCommand(argv, [StartupCommands.CONTENT, 'update-content'], 'Only download content. Parses your config as `config.content || config`.');
		argv = addCommand(argv, [StartupCommands.MONITOR, 'start-apps'], 'Only start apps. Parses your config as `config.monitor || config`.');
		argv = addCommand(argv, [StartupCommands.SCAFFOLD], 'Configures the current PC for exhibit environments (with admin prompt).');
		argv = addCommand(argv, [StartupCommands.STOP, 'stop-apps'], 'Stops and kills any existing PM2 instance.');
		return argv;
	}
}).then(async config => {
	const launchpad = new LaunchpadCore(config);
	
	onExit(async () => {
		await launchpad.shutdown();
	});
	
	switch (config.startupCommand) {
		case StartupCommands.SCAFFOLD: {
			await launchScaffold(config);
			break;
		}
		case StartupCommands.CONTENT: {
			await launchpad.updateContent();
			await launchpad.shutdown();
			break;
		}
		case StartupCommands.MONITOR: {
			await launchpad.startApps();
			break;
		}
		case StartupCommands.STOP: {
			await launchpad.stopApps();
			await LaunchpadMonitor.kill();
			break;
		}
		case StartupCommands.START:
		default: {
			await launchpad.startup();
			break;
		}
	}

}).catch(err => {
	if (err) {
		console.error('Launch error', err);
		process.exit(1);
	}
});
