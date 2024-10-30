import { err, errAsync, ok, ResultAsync } from 'neverthrow';
import { findConfig, loadConfigFromFile } from './config.js';
import { ConfigError } from '../errors.js';
import path from 'path';
import { resolveEnv } from './env.js';
import { resolveLaunchpadOptions } from '../launchpad-options.js';
import chalk from 'chalk';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 * @returns {import('neverthrow').ResultAsync<import('../launchpad-options.js').ResolvedLaunchpadOptions, ConfigError>}
 */
export function loadConfigAndEnv(argv) {
	const configPath = argv.config ?? findConfig();

	if (!configPath) {
		return errAsync(new ConfigError('No config file found.'));
	}

	const configDir = path.dirname(configPath);

	if (argv.env) {
		// if env arg is passed, resolve paths relative to the CWD
		const rootDir = process.env.INIT_CWD ?? '';
		resolveEnv(
			argv.env.map(p => path.resolve(rootDir, p.toString()))
		);
	} else if (argv.envCascade) {
		// if env-cascade arg is passed, resolve paths relative to the config file

		// Load order: .env < .env.local < .env.[override] < .env.[override].local
		resolveEnv([
			path.resolve(configDir, '.env'),
			path.resolve(configDir, '.env.local'),
			path.resolve(configDir, `.env.${argv.envCascade}`),
			path.resolve(configDir, `.env.${argv.envCascade}.local`)
		]);
	} else {
		// default to loading .env and .env.local in the config dir
		resolveEnv([
			path.resolve(configDir, '.env'),
			path.resolve(configDir, '.env.local')
		]);
	}

	return ResultAsync.fromPromise(loadConfigFromFile(configPath), (e) => new ConfigError(`Failed to load config file at path: ${chalk.white(configPath)}`))
		.map(config => resolveLaunchpadOptions(config));
}
