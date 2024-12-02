#!/usr/bin/env node

import { hideBin } from "yargs/helpers";
import yargs from "yargs";

export type LaunchpadArgv = {
	config?: string;
	env?: (string | number)[];
	envCascade?: string;
};

yargs(hideBin(process.argv))
	.scriptName("launchpad")
	.usage("Usage: $0 <command> [options]")
	.option("config", { alias: "c", describe: "Path to your JS config file", type: "string" })
	.option("env", { alias: "e", describe: "Path(s) to your .env file(s)", type: "array" })
	.option("env-cascade", {
		alias: "E",
		describe:
			"cascade env variables from `.env`, `.env.<arg>`, `.env.local`, `.env.<arg>.local` in launchpad root dir",
		type: "string",
	})
	.parserConfiguration({
		// See https://github.com/yargs/yargs-parser#camel-case-expansion
		"camel-case-expansion": false,
	})
	.command(
		"start",
		"Starts launchpad by updating content and starting apps.",
		(yargs) => yargs,
		async (args) => {
			const resolvedArgv = await args;
			const { start } = await import("./commands/start.js");
			await start(resolvedArgv);
		},
	)
	.command(
		"stop",
		"Stops launchpad by stopping apps and killing any existing PM2 instance.",
		(yargs) => yargs,
		async (args) => {
			const resolvedArgv = await args;
			const { stop } = await import("./commands/stop.js");
			await stop(resolvedArgv);
		},
	)
	.command(
		"content",
		"Only download content.",
		(yargs) => yargs,
		async (args) => {
			const resolvedArgv = await args;
			const { content } = await import("./commands/content.js");
			await content(resolvedArgv);
		},
	)
	.command(
		"monitor",
		"Only start apps.",
		(yargs) => yargs,
		async (args) => {
			const resolvedArgv = await args;
			const { monitor } = await import("./commands/monitor.js");
			await monitor(resolvedArgv);
		},
	)
	.command("scaffold", "Commands for managing deployments", (yargs) => {
		return yargs
			.usage("Usage: $0 scaffold <command> [options]")
			.command(
				"new [dir]",
				"create a new scaffold project",
				(yargs) =>
					yargs
						.positional("dir", {
							type: "string",
							default: ".",
							describe: "The directory to create the project in",
						})
						.showHelpOnFail(false),
				async (args) => {
					const resolvedArgv = await args;
					const { scaffoldNew } = await import("./commands/scaffold/new.js");
					await scaffoldNew(resolvedArgv);
				},
			)
			.command(
				"init [dir]",
				"initialize an existing scaffold project",
				(yargs) =>
					yargs
						.positional("dir", {
							type: "string",
							default: ".",
							describe: "The directory to create the project in",
						})
						.showHelpOnFail(false),
				() => {
					console.log("TODO");
				},
			)
			.command(
				"deploy",
				"deploy to remote host",
				(yargs) => yargs,
				() => {
					console.log("TODO");
				},
			)
			.command(
				"logs",
				"tails the logs of the remote deployment",
				(yargs) => yargs,
				() => {
					console.log("TODO");
				},
			)
			.demandCommand()
			.help();
	})
	.help("h")
	.alias("h", "help")
	.strictCommands()
	.demandCommand()
	.wrap(null)
	.parse();
