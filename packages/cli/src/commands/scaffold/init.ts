import type { LaunchpadArgv } from "../../cli.js";
import { initScaffold } from "@bluecadet/launchpad-scaffold";

type ScaffoldNewArgv = LaunchpadArgv & {
	dir: string;
};

export async function scaffoldNew(argv: ScaffoldNewArgv) {
	const cwd = process.cwd();
	await initScaffold({ dir: argv.dir, cwd });
}
