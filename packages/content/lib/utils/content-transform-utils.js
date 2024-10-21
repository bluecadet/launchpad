import chalk from 'chalk';
import { err, ok } from 'neverthrow';


/**
 * @typedef {Array<string | [string] | [string, string]>} DataKeys A list containing a combination of namespace ids, and namespace/document id tuples.
 */

/**
 * @param {import('./data-store.js').DataStore} dataStore
 * @param {DataKeys | undefined } ids A list containing a combination of namespace ids, and namespace/document id tuples. If not provided, all documents will be matched.
 * @returns {import('neverthrow').Result<Iterable<import('./data-store.js').Document>, string>}
 */
export function getMatchingDocuments(dataStore, ids) {
	if (!ids) {
		return ok(dataStore.allDocuments());
	}

	/** @type {Array<import('./data-store.js').Document>} */
	const documents = [];

	for (const id of ids) {
		if (Array.isArray(id) && id.length === 2) {
			const [namespaceId, documentId] = id;
			const result = dataStore.get(namespaceId, documentId);

			if (result.isErr()) {
				return err(result.error);
			}

			documents.push(result.value);
		} else {
			const idStr = Array.isArray(id) ? id[0] : id;

			const result = dataStore.documents(idStr);

			if (result.isErr()) {
				return err(result.error);
			}

			documents.push(...result.value);
		}
	}

	return ok(documents);
}

/**
 * Shared logic for content transforms
 * @param {object} params
 * @param {import('./data-store.js').DataStore} params.dataStore
 * @param {string} params.path
 * @param {(content: unknown) => unknown} params.transformFn
 * @param {import('@bluecadet/launchpad-utils').Logger} params.logger
 * @param {DataKeys} [params.keys]
 */
export function applyTransformToFiles({ dataStore, path, transformFn, logger, keys }) {
	const pathStr = chalk.yellow(path);

	const matchingDocuments = getMatchingDocuments(dataStore, keys);

	if (matchingDocuments.isErr()) {
		return matchingDocuments.error;
	}

	for (const document of matchingDocuments.value) {
		logger.debug(
			chalk.gray(`Applying content transform to '${pathStr}' for key '${document.id}'`));

		document.apply(path, transformFn);
	}
}

/**
 * @param {unknown} content
 * @returns {content is { _type: "block" }}
 */
export function isBlockContent(content) {
	// check if object
	if (typeof content !== 'object' || content === null) {
		return false;
	}

	// check if block
	if (!('_type' in content) || content._type !== 'block') {
		return false;
	}

	return true;
}
