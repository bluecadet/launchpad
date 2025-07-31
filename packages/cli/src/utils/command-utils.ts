import path from "node:path";
import { type Logger, LogManager, TTY_FIXED_END } from "@bluecadet/launchpad-utils";
import chalk from "chalk";
import { errAsync, ok, ResultAsync } from "neverthrow";
import { ZodError } from "zod";
import type { LaunchpadArgv } from "../cli.js";
import { ConfigError } from "../errors.js";
import { type ResolvedLaunchpadOptions, resolveLaunchpadConfig } from "../launchpad-config.js";
import { findConfig, loadConfigFromFile } from "./config.js";
import { resolveEnv } from "./env.js";

export function loadConfigAndEnv(
	argv: LaunchpadArgv,
): ResultAsync<{ dir: string; config: ResolvedLaunchpadOptions }, ConfigError> {
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
			path.resolve(configDir, `.env.${argv.envCascade}.local`),
			path.resolve(configDir, `.env.${argv.envCascade}`),
			path.resolve(configDir, ".env.local"),
			path.resolve(configDir, ".env"),
		]);
	} else {
		// default to loading .env and .env.local in the config dir
		resolveEnv([path.resolve(configDir, ".env.local"), path.resolve(configDir, ".env")]);
	}

	return ResultAsync.fromPromise(
		loadConfigFromFile(configPath),
		(e) =>
			new ConfigError(`Failed to load config file at path: ${chalk.white(configPath)}`, {
				cause: e,
			}),
	).map((config) => ({ dir: configDir, config: resolveLaunchpadConfig(config) }));
}

export function initializeLogger(config: ResolvedLaunchpadOptions, cwd?: string) {
	const rootLogger = LogManager.configureRootLogger(config.logging, cwd);

	return ok(rootLogger);
}

export function handleFatalError(error: Error, rootLogger: Logger | Console): never {
	logFullErrorChain(rootLogger, error);
	process.exit(1);
}

function logFullErrorChain(logger: Logger | Console, error: Error) {
	let currentError: Error | undefined = error;

	// clear any fixed messages
	logger.info("", { [TTY_FIXED_END]: true });

	logger.error("");
	logger.error(`${chalk.red.bold("Full error chain:")}`);
	logger.error("");

	while (currentError) {
		logger.error(
			`${chalk.red("┌─")} ${chalk.red.bold(currentError.name)}: ${chalk.red(getPrettyMessage(currentError))}`,
		);
		const callstack = currentError.stack;

		if (callstack) {
			logger.error(`${chalk.red("│")}`);

			const lines = callstack.split("\n").slice(1);

			for (const line of lines) {
				logger.error(`${chalk.red("│")} ${chalk.red.dim(line)}`);
			}

			logger.error(`${chalk.red("│")}`);
			logger.error(`${chalk.red("└──────────────────")}`);
		}

		if (currentError.cause && currentError.cause instanceof Error) {
			currentError = currentError.cause;
			logger.error(`    ${chalk.red.dim("│")} ${chalk.red.dim("Caused by:")}`);
			logger.error(`    ${chalk.red.dim("│")}`);
		} else {
			currentError = undefined;
		}
	}

	logger.error("");
}

function getPrettyMessage(e: Error): string {
	if (e instanceof ZodError) {
		return formatZodError(e);
	}

	return e.message;
}

function formatZodError(e: ZodError): string {
	return e.errors
		.map((issue) => {
			const path = issue.path.length ? `property "${issue.path.join(".")}"` : "<root>";
			let additionalInfo = "";

			if ("expected" in issue) {
				additionalInfo = ` (expected: ${issue.expected}, received: ${issue.received})`;
			}

			return `${path}: ${issue.message}${additionalInfo}`;
		})
		.join("\n");
}
