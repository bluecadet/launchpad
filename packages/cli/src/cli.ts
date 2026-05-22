#!/usr/bin/env node

import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { cliLogger } from "./utils/cli-logger.js";

export type GlobalLaunchpadArgs = {
	config?: string;
	env?: (string | number)[];
	envCascade?: string;
	verbose?: number;
};

(async () => {
	const argv = hideBin(process.argv);

	let yargsInstance: Argv = yargs(argv)
		.option("config", { alias: "c", describe: "Path to your JS config file", type: "string" })
		.option("env", { alias: "e", describe: "Path(s) to your .env file(s)", type: "array" })
		.option("verbose", { alias: "v", describe: "Increase logging verbosity", type: "count" })
		.count("verbose")
		.option("env-cascade", {
			alias: "E",
			describe:
				"cascade env variables from `.env`, `.env.<arg>`, `.env.local`, `.env.<arg>.local` in launchpad root dir",
			type: "string",
		})
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
				await start(args);
			},
		)
		.command(
			"stop",
			"Stops launchpad controller gracefully.",
			() => {},
			async (args) => {
				const { stop } = await import("./commands/stop.js");
				await stop(args);
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
				await status(args);
			},
		);

	const { loadConfigAndEnv, handleFatalError } = await import("./utils/command-utils.js");
	const { registerPluginCliCommands } = await import("./utils/plugin-cli-registration.js");

	const parsedGlobal = await yargs(argv)
		.option("config", { alias: "c", type: "string" })
		.option("env", { alias: "e", type: "array" })
		.option("env-cascade", { alias: "E", type: "string" })
		.help(false)
		.version(false)
		.parseAsync();

	const configResult = await loadConfigAndEnv(parsedGlobal as GlobalLaunchpadArgs);

	if (configResult.isOk()) {
		const { dir, config } = configResult.value;
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

	await yargsInstance.help().parseAsync();
})();
