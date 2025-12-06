import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

export async function loadHandlebarsTemplate<T = Record<string, never>>(resolvedPath: string) {
	const templateContent = await fs.promises.readFile(fileURLToPath(resolvedPath), "utf-8");
	return Handlebars.compile<T>(templateContent);
}
