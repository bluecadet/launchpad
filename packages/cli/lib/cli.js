#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
export { defineConfig } from './launchpad-config.js';

/**
 * @typedef LaunchpadArgv
 * @property {string} [config]
 * @property {(string | number)[]} [env]
 * @property {string} [envCascade]
 */

yargs(hideBin(process.argv))
	.parserConfiguration({
		// See https://github.com/yargs/yargs-parser#camel-case-expansion
		'camel-case-expansion': false
	})
	.option('config', { alias: 'c', describe: 'Path to your JS config file', type: 'string' })
	.option('env', { alias: 'e', describe: 'Path(s) to your .env file(s)', type: 'array' })
	.option('env-cascade', { alias: 'E', describe: 'cascade env variables from `.env`, `.env.<arg>`, `.env.local`, `.env.<arg>.local` in launchpad root dir', type: 'string' })
	.command('start', 'Starts launchpad by updating content and starting apps.', async ({ argv }) => {
		const resolvedArgv = await argv;
		const { start } = await import('./commands/start.js');
		await start(resolvedArgv);
	})
	.command('stop', 'Stops launchpad by stopping apps and killing any existing PM2 instance.', async ({ argv }) => {
		const resolvedArgv = await argv;
		const { stop } = await import('./commands/stop.js');
		await stop(resolvedArgv);
	})
	.command('content', 'Only download content.', async ({ argv }) => {
		const resolvedArgv = await argv;
		const { content } = await import('./commands/content.js');
		await content(resolvedArgv);
	})
	.command('monitor', 'Only start apps.', async ({ argv }) => {
		const resolvedArgv = await argv;
		const { monitor } = await import('./commands/monitor.js');
		await monitor(resolvedArgv);
	})
	.command('scaffold', 'Configures the current PC for exhibit environments (with admin prompt).', async ({ argv }) => {
		const resolvedArgv = await argv;
		const { scaffold } = await import('./commands/scaffold.js');
		await scaffold(resolvedArgv);
	})
	.help()
	.parse();
