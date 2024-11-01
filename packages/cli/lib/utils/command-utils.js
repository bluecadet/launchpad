import { err, errAsync, ok, ResultAsync } from 'neverthrow';
import { findConfig, loadConfigFromFile } from './config.js';
import { ConfigError } from '../errors.js';
import path from 'path';
import { resolveEnv } from './env.js';
import { resolveLaunchpadConfig } from '../launchpad-config.js';
import chalk from 'chalk';
import { LogManager } from '@bluecadet/launchpad-utils';

/**
 * @param {import("../cli.js").LaunchpadArgv} argv
 * @returns {import('neverthrow').ResultAsync<import('../launchpad-config.js').ResolvedLaunchpadOptions, ConfigError>}
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
		.map(config => resolveLaunchpadConfig(config));
}

/**
 * 
 * @param {import('../launchpad-config.js').LaunchpadConfig} config 
 */
export function initializeLogger(config) {
	const rootLogger = LogManager.configureRootLogger(config.logging);

	return ok({ config, rootLogger });
}

/**
 * 
 * @param {Error} error 
 * @param {import('@bluecadet/launchpad-utils').Logger} rootLogger
 * @returns {never}
 */
export function handleFatalError(error, rootLogger) {
	rootLogger.error('Content failed to download.');
	logFullErrorChain(rootLogger, error);
	process.exit(1);
}

/**
 * @param {import('@bluecadet/launchpad-utils').Logger} logger
 * @param {Error} error
 */
export function logFullErrorChain(logger, error) {
	/** @type {Error | undefined} */
	let currentError = error;
	while (currentError) {
		logger.error(`${chalk.red('┌─')} ${chalk.red.bold(currentError.name)}: ${chalk.red(currentError.message)}`);
		const callstack = currentError.stack;
		// logger.error(`${chalk.red(callstack ? '│' : '└')} `);
		if (callstack) {
			const lines = callstack.split('\n').slice(1);
			// log up to 3 lines of the callstack
			let loggedLines = 0;
			for (const line of lines) {
				const isLastLine = loggedLines === lines.length - 1 || loggedLines > 2;
				logger.error(`${chalk.red('│')} ${chalk.red.dim((isLastLine && lines.length > 3) ? '...' : line.trim())}`);
				if (isLastLine) {
					logger.error(`${chalk.red('└──────────────────')}`);
				}
				loggedLines++;

				if (loggedLines > 3) {
					break;
				}
			}
		}
		if (currentError.cause && currentError.cause instanceof Error) {
			currentError = currentError.cause;
			logger.error(`    ${chalk.red.dim('│')} ${chalk.red.dim('Caused by:')}`);
			logger.error(`    ${chalk.red.dim('│')}`);
		} else {
			currentError = undefined;
		}
	}
}
