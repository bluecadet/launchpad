import { err, errAsync, ok, ResultAsync } from "neverthrow";
import { findConfig, loadConfigFromFile } from "./config.js";
import { ConfigError } from "../errors.js";
import path from "node:path";
import { resolveEnv } from "./env.js";
import { resolveLaunchpadConfig, type ResolvedLaunchpadOptions } from "../launchpad-config.js";
import chalk from "chalk";
import { LogManager, type Logger } from "@bluecadet/launchpad-utils";
import type { LaunchpadArgv } from "../cli.js";

export function loadConfigAndEnv(argv: LaunchpadArgv): ResultAsync<ResolvedLaunchpadOptions, ConfigError> {
	const configPath = argv.config ?? findConfig();

	if (!configPath) {
		return errAsync(new ConfigError("No config file found."));
	}

	const configDir = path.dirname(configPath);

	if (argv.env) {
		// if env arg is passed, resolve paths relative to the CWD
		const rootDir = process.env.INIT_CWD ?? "";
		resolveEnv(argv.env.map((p) => path.resolve(rootDir, p.toString())));
	} else if (argv.envCascade) {
		// if env-cascade arg is passed, resolve paths relative to the config file

		// Load order: .env < .env.local < .env.[override] < .env.[override].local
		resolveEnv([
			path.resolve(configDir, ".env"),
			path.resolve(configDir, ".env.local"),
			path.resolve(configDir, `.env.${argv.envCascade}`),
			path.resolve(configDir, `.env.${argv.envCascade}.local`),
		]);
	} else {
		// default to loading .env and .env.local in the config dir
		resolveEnv([path.resolve(configDir, ".env"), path.resolve(configDir, ".env.local")]);
	}

	return ResultAsync.fromPromise(loadConfigFromFile(configPath), (e) => new ConfigError(`Failed to load config file at path: ${chalk.white(configPath)}`)).map(
		(config) => resolveLaunchpadConfig(config),
	);
}

export function initializeLogger(config: ResolvedLaunchpadOptions) {
	const rootLogger = LogManager.configureRootLogger(config.logging);

	return ok({ config, rootLogger });
}

export function handleFatalError(error: Error, rootLogger: Logger): never {
	rootLogger.error("Content failed to download.");
	logFullErrorChain(rootLogger, error);
	process.exit(1);
}

export function logFullErrorChain(logger: Logger, error: Error) {
	let currentError: Error | undefined = error;
	while (currentError) {
		logger.error(`${chalk.red("┌─")} ${chalk.red.bold(currentError.name)}: ${chalk.red(currentError.message)}`);
		const callstack = currentError.stack;
		// logger.error(`${chalk.red(callstack ? '│' : '└')} `);
		if (callstack) {
			const lines = callstack.split("\n").slice(1);
			// log up to 3 lines of the callstack
			let loggedLines = 0;
			for (const line of lines) {
				const isLastLine = loggedLines === lines.length - 1 || loggedLines > 2;
				logger.error(`${chalk.red("│")} ${chalk.red.dim(isLastLine && lines.length > 3 ? "..." : line.trim())}`);
				if (isLastLine) {
					logger.error(`${chalk.red("└──────────────────")}`);
				}
				loggedLines++;

				if (loggedLines > 3) {
					break;
				}
			}
		}
		if (currentError.cause && currentError.cause instanceof Error) {
			currentError = currentError.cause;
			logger.error(`    ${chalk.red.dim("│")} ${chalk.red.dim("Caused by:")}`);
			logger.error(`    ${chalk.red.dim("│")}`);
		} else {
			currentError = undefined;
		}
	}
}
