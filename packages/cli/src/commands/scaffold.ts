import { launchScaffold } from "@bluecadet/launchpad-scaffold";
import { LogManager } from "@bluecadet/launchpad-utils";
import type { GlobalLaunchpadArgs } from "../cli.js";

export async function scaffold(_argv: GlobalLaunchpadArgs) {
	const rootLogger = LogManager.configureRootLogger();
	await launchScaffold(rootLogger);
}
