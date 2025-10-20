#!/usr/bin/env node

import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";

export { defineConfig } from "./launchpad-config.js";

export type LaunchpadArgv = {
	config?: string;
	env?: (string | number)[];
	envCascade?: string;
};

yargs(hideBin(process.argv))
	.parserConfiguration({
		// See https://github.com/yargs/yargs-parser#camel-case-expansion
		"camel-case-expansion": false,
	})
	.option("config", { alias: "c", describe: "Path to your JS config file", type: "string" })
	.option("env", { alias: "e", describe: "Path(s) to your .env file(s)", type: "array" })
	.option("env-cascade", {
		alias: "E",
		describe:
			"cascade env variables from `.env`, `.env.<arg>`, `.env.local`, `.env.<arg>.local` in launchpad root dir",
		type: "string",
	})
	.command("start", "Starts launchpad controller.", async ({ argv }) => {
		const resolvedArgv = (await argv) as LaunchpadArgv & { daemon?: boolean; d?: boolean };
		const { start } = await import("./commands/start.js");
		await start(resolvedArgv);
	})
	.command("stop", "Stops launchpad controller gracefully.", async ({ argv }) => {
		const resolvedArgv = await argv;
		const { stop } = await import("./commands/stop.js");
		await stop(resolvedArgv);
	})
	.command("status", "Show the status of the launchpad controller.", async ({ argv }) => {
		const resolvedArgv = await argv;
		const { status } = await import("./commands/status.js");
		await status(resolvedArgv);
	})
	.command("content", "Run content fetch process.", async ({ argv }) => {
		const resolvedArgv = await argv;
		const { content } = await import("./commands/content.js");
		await content(resolvedArgv);
	})
	.command("monitor", "Run monitor process.", async ({ argv }) => {
		const resolvedArgv = await argv;
		const { monitor } = await import("./commands/monitor.js");
		await monitor(resolvedArgv);
	})
	.command(
		"scaffold",
		"Configures the current PC for exhibit environments (with admin prompt).",
		async ({ argv }) => {
			const resolvedArgv = await argv;
			const { scaffold } = await import("./commands/scaffold.js");
			await scaffold(resolvedArgv);
		},
	)
	.help()
	.parse();
