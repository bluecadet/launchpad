import LaunchpadMonitor from "@bluecadet/launchpad-monitor";
import { LogManager } from "@bluecadet/launchpad-utils";
import type { LaunchpadArgv } from "../cli.js";

export async function stop(_argv: LaunchpadArgv) {
	const logger = LogManager.configureRootLogger();
	await LaunchpadMonitor.kill(logger);
}
