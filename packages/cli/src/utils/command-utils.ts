import path from "node:path";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import chalk from "chalk";
import { errAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ConfigError } from "../errors.js";
import { type ResolvedLaunchpadOptions, resolveLaunchpadConfig } from "../launchpad-config.js";
import { cliLogger } from "./cli-logger.js";
import { findFirstConfigRecursive, loadConfigFromFile } from "./config.js";
import { resolveEnv } from "./env.js";

export type LoadedConfig = { dir: string; config: ResolvedLaunchpadOptions };

export function loadConfigAndEnv(
	argv: GlobalLaunchpadArgs,
): ResultAsync<LoadedConfig, ConfigError> {
	const configPath = argv.config ?? findFirstConfigRecursive();

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
				cause: ensureError(e),
			}),
	).map((config) => ({ dir: configDir, config: resolveLaunchpadConfig(config) }));
}

export function handleFatalError(error: Error) {
	cliLogger.error(error);
	return process.exit(1);
}
