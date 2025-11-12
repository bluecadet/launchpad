import { launchScaffold } from "@bluecadet/launchpad-scaffold";
import type { GlobalLaunchpadArgs } from "../cli.js";

export async function scaffold(_argv: GlobalLaunchpadArgs) {
	await launchScaffold();
}
