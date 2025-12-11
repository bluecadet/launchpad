import fs from "node:fs";
import HB from "handlebars";
import { Result, ResultAsync } from "neverthrow";

// re-export handlebars with noConflict to avoid issues with global namespace.
// All first-party usage of handlebars should use this instance.
export const Handlebars = HB.noConflict();

Handlebars.registerHelper(
	"ifMatch",
	function (this: Handlebars.HelperDelegate, arg1, arg2, options) {
		return arg1 === arg2 ? options.fn(this) : options.inverse(this);
	},
);

const formatter = new Intl.DateTimeFormat("default", {
	dateStyle: "short",
	timeStyle: "short",
});

Handlebars.registerHelper("formatDate", (timestamp: Date) => {
	return formatter.format(timestamp);
});

Handlebars.registerHelper(
	"ifMultiple",
	function (
		this: Handlebars.HelperDelegate,
		data: Array<unknown> | Map<unknown, unknown> | Set<unknown> | Record<string, unknown>,
		options,
	) {
		if ("size" in data && typeof data.size === "number") {
			return data.size > 1 ? options.fn(this) : options.inverse(this);
		}
		if (Array.isArray(data)) {
			return data.length > 1 ? options.fn(this) : options.inverse(this);
		}

		return Object.keys(data).length > 1 ? options.fn(this) : options.inverse(this);
	},
);

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
