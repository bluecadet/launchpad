import { downloadTemplate } from "@bluwy/giget-core";
import fs from "node:fs/promises";
import path from "node:path";
import { getVersion } from "./utils/get-version.js";
import { initScaffold } from "./init.js";

const FILES_TO_REMOVE = [
	"package.json", // only needed for changesets
	"CHANGELOG.md", // created by changesets
];

export async function newScaffold(options: {
	dir: string;
	cwd: string;
}) {
	// read version number from package.json
	const version = await getVersion();

	await downloadScaffoldTemplate(options.dir, options.cwd, version);
}

async function downloadScaffoldTemplate(dir: string, cwd: string, version: string) {
	const tag = `@bluecadet/launchpad-scaffold@${version}`;

	await downloadTemplate(`github:bluecadet/launchpad/packages/scaffold-template#${tag}`, {
		dir: dir,
		cwd: cwd,
	});

	const resolvedDir = path.resolve(cwd, dir);

	for (const file of FILES_TO_REMOVE) {
		const filePath = path.join(resolvedDir, file);
		try {
			await fs.unlink(filePath);
		} catch (err) {
			if (err instanceof Error && "code" in err && err.code === "ENOENT") {
				// ignore
			} else {
				throw err;
			}
		}
	}

	updateGalaxyVersion(resolvedDir, version);

	try {
		initScaffold({
			dir: resolvedDir,
			cwd: cwd,
		});
	} catch (err) {
		throw new Error("Failed to initialize scaffold", { cause: err });
	}
}

async function updateGalaxyVersion(dir: string, version: string) {
	const galaxyFile = path.join(dir, "galaxy.yml");

	const REPLACE_PATTERN = "%SCAFFOLD_VERSION%";

	const content = await fs.readFile(galaxyFile, "utf8");

	const updatedContent = content.replace(REPLACE_PATTERN, version);

	await fs.writeFile(galaxyFile, updatedContent);
}
