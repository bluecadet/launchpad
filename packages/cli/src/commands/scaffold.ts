import { launchScaffold } from "@bluecadet/launchpad-scaffold";
import { LogManager } from "@bluecadet/launchpad-utils";
import type { LaunchpadArgv } from "../cli.js";

export async function scaffold(argv: LaunchpadArgv) {
	const rootLogger = LogManager.configureRootLogger();
	await launchScaffold(rootLogger);
}
