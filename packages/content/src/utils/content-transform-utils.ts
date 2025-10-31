import type { Logger } from "@bluecadet/launchpad-utils/log-manager";
import chalk from "chalk";
import { ok, type Result } from "neverthrow";
import type { DataKeys, DataStore, Document } from "./data-store.js";

/**
 * @param ids A list containing a combination of namespace ids, and namespace/document id tuples. If not provided, all documents will be matched.
 */
export function getMatchingDocuments(
	dataStore: DataStore,
	ids?: DataKeys,
): Result<Iterable<Document>, Error> {
	if (!ids) {
		return ok(dataStore.allDocuments());
	}

	return dataStore.filter(ids).map((results) => results.flatMap((result) => result.documents));
}

export function regexToJSONPathQuery(regex: RegExp): string {
	return `$..[?(@.match(${regex}))]`;
}

type ApplyTransformToFilesParams = {
	dataStore: DataStore;
	path: string;
	transformFn: (content: unknown) => unknown;
	logger: Logger;
	keys?: DataKeys;
};

/**
 * Shared logic for content transforms
 */
export async function applyTransformToFiles({
	dataStore,
	path,
	transformFn,
	logger,
	keys,
}: ApplyTransformToFilesParams) {
	const pathStr = chalk.yellow(path);

	const matchingDocuments = getMatchingDocuments(dataStore, keys);

	if (matchingDocuments.isErr()) {
		throw matchingDocuments.error;
	}

	for (const document of matchingDocuments.value) {
		logger.debug(chalk.gray(`Applying content transform to '${pathStr}' for key '${document.id}'`));

		await document.apply(path, transformFn);
	}
}

export function isBlockContent(content: unknown): content is { _type: "block" } {
	// check if object
	if (typeof content !== "object" || content === null) {
		return false;
	}

	// check if block
	if (!("_type" in content) || content._type !== "block") {
		return false;
	}

	return true;
}
