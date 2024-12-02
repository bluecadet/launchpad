import path from "node:path";
import fs from "node:fs/promises";

let cached: string | null = null;

/** read version number from package.json  */
export async function getVersion(): Promise<string> {
	if (cached) {
		return cached;
	}

	const pkgPath = path.join(import.meta.dirname, "..", "..", "package.json");
	const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

	if (!pkg || !pkg.version || typeof pkg.version !== "string") {
		throw new Error("Invalid package.json");
	}

	cached = pkg.version;

	return pkg.version;
}
