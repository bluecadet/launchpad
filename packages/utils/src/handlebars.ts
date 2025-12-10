import fs from "node:fs";
import { fileURLToPath } from "node:url";
import HB from "handlebars";

// re-export handlebars with noConflict to avoid issues with global namespace.
// All first-party usage of handlebars should use this instance.
export const Handlebars = HB.noConflict();

export async function loadHandlebarsTemplate<T = Record<string, never>>(resolvedPath: string) {
	const templateContent = await fs.promises.readFile(fileURLToPath(resolvedPath), "utf-8");
	return Handlebars.compile<T>(templateContent);
}
