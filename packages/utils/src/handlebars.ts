import fs from "node:fs";
import HB from "handlebars";
import { Result, ResultAsync } from "neverthrow";

// re-export handlebars with noConflict to avoid issues with global namespace.
// All first-party usage of handlebars should use this instance.
export const Handlebars = HB.noConflict();

const safeRead = ResultAsync.fromThrowable(
	fs.promises.readFile,
	(e) => new Error(`Failed to read file: ${(e as Error).message}`),
);

const safeCompile = Result.fromThrowable(
	Handlebars.compile,
	(e) => new Error(`Failed to compile Handlebars template: ${(e as Error).message}`),
);

export function loadHandlebarsTemplate<T = Record<string, never>>(
	resolvedPath: string,
): ResultAsync<HB.TemplateDelegate<T>, Error> {
	return safeRead(resolvedPath, "utf-8").andThen((content) => safeCompile(content));
}
