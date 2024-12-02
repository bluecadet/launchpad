import { downloadTemplate } from "@bluwy/giget-core";

type ScaffoldOptions = {
  dir: string;
  cwd: string;
};

export async function newScaffold(options: ScaffoldOptions) {
	await downloadTemplate("bluecadet:launchpad/packages/scaffold-template", {
    dir: options.dir,
    cwd: options.cwd,
  });
}
