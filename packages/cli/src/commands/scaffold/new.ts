import { newScaffold } from "@bluecadet/launchpad-scaffold";
import type { LaunchpadArgv } from "../../cli.js";

type ScaffoldNewArgv = LaunchpadArgv & {
	dir: string;
};

export async function scaffoldNew(argv: ScaffoldNewArgv) {
	const cwd = process.cwd();
	await newScaffold({ dir: argv.dir, cwd });
}
