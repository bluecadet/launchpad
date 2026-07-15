import type { Argv } from "yargs";
import yargs from "yargs/yargs";
import { cliLogger } from "./utils/cli-logger.js";
import type { LoadedConfig } from "./utils/command-utils.js";

export type GlobalLaunchpadArgs = {
	config?: string;
	env?: (string | number)[];
	envCascade?: string;
	verbose?: number;
};

/** Declares options that can appear before or after a command. */
function withGlobalOptions(y: Argv): Argv {
	return y
		.option("config", { alias: "c", describe: "Path to your JS config file", type: "string" })
		.option("env", {
			alias: "e",
			describe: "Path(s) to your .env file(s)",
			nargs: 1,
			type: "array",
		})
		.option("env-cascade", {
			alias: "E",
			describe:
				"cascade env variables from `.env`, `.env.<arg>`, `.env.local`, `.env.<arg>.local` in launchpad root dir",
			type: "string",
		})
		.option("verbose", { alias: "v", describe: "Increase logging verbosity", type: "count" })
		.count("verbose");
}

export async function run(argv: string[]): Promise<void> {
	const { loadConfigAndEnv, handleFatalError } = await import("./utils/command-utils.js");
	const { registerPluginCliCommands } = await import("./utils/plugin-cli-registration.js");

	// Plugin CLI commands are registered dynamically from the resolved config, so
	// it must be loaded before yargs parses argv. Pre-parse the global options so
	// the config + env files load exactly once, then share that single
	// result with both plugin CLI registration and the built-in command handlers.
	const parsedGlobal = await withGlobalOptions(yargs(argv)).help(false).version(false).parseAsync();

	const resolvedConfig = await loadConfigAndEnv(parsedGlobal as GlobalLaunchpadArgs);

	// Built-in commands require a config; resolve it or fail fast. Deferred until a
	// command actually runs so `--help` and plugin discovery tolerate a missing config.
	const requireConfig = (): LoadedConfig =>
		resolvedConfig.match(
			(value) => value,
			(error) => handleFatalError(error),
		);

	let yargsInstance: Argv = withGlobalOptions(yargs(argv))
		.middleware(async (args) => {
			switch (args.verbose) {
				case 1:
					cliLogger.setLevel("verbose");
					break;
				case 2:
					cliLogger.setLevel("debug");
					break;
				default:
					cliLogger.setLevel("info");
					break;
			}
		})
		.command(
			"start",
			"Starts launchpad controller.",
			(y) => {
				return y.option("detach", {
					alias: "d",
					describe: "Run in the background (detached mode)",
					type: "boolean",
					default: false,
				});
			},
			async (args) => {
				const { start } = await import("./commands/start.js");
				await start(args, requireConfig());
			},
		)
		.command(
			"stop",
			"Stops launchpad controller gracefully.",
			() => {},
			async () => {
				const { stop } = await import("./commands/stop.js");
				await stop(requireConfig());
			},
		)
		.command(
			"status",
			"Show the status of the launchpad controller.",
			(y) => {
				return y.option("watch", {
					alias: "w",
					describe: "Watch for status changes",
					type: "boolean",
					default: false,
				});
			},
			async (args) => {
				const { status } = await import("./commands/status.js");
				await status(args, requireConfig());
			},
		);

	if (resolvedConfig.isOk()) {
		const { dir, config } = resolvedConfig.value;
		const entries = (config.plugins ?? []).flatMap((pluginConfig) => {
			const cli = pluginConfig.manifest?.cli;
			if (!cli) return [];
			return cli.map((declaration) => ({ pluginConfig, declaration }));
		});

		if (entries.length > 0) {
			try {
				yargsInstance = registerPluginCliCommands(yargsInstance, entries, dir, config.controller);
			} catch (err) {
				handleFatalError(err instanceof Error ? err : new Error(String(err)));
			}
		}
	}

	yargsInstance = yargsInstance.help().fail((msg, err) => {
		if (err) {
			// Runtime failure inside a command handler — yargs' default behavior
			// would dump the command's usage text before the error. Just report it.
			handleFatalError(err);
			return;
		}
		yargsInstance.showHelp("log");
		cliLogger.error(msg);
		process.exit(1);
	});
	const hasCommand = parsedGlobal._.length > 0;
	if (!hasCommand && !argv.includes("--version")) {
		yargsInstance.showHelp("log");
		return;
	}

	await yargsInstance.parseAsync();
}
