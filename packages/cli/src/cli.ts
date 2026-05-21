#!/usr/bin/env node

import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { cliLogger } from "./utils/cli-logger.js";

export type GlobalLaunchpadArgs = {
	config?: string;
	env?: (string | number)[];
	envCascade?: string;
	verbose?: number;
};

yargs(hideBin(process.argv))
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
		(yargs) => {
			return yargs.option("detach", {
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
		(yargs) => {
			return yargs.option("watch", {
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
	)
	.command(
		"content",
		"Run content fetch process.",
		() => {},
		async (args) => {
			const { content } = await import("./commands/content.js");
			await content(args);
		},
	)
	.command(
		"monitor",
		"Run monitor process.",
		() => {},
		async (args) => {
			const { monitor } = await import("./commands/monitor.js");
			await monitor(args);
		},
	)
	.help()
	.parse();
