import chalk from 'chalk';
import { err, ok, Result } from 'neverthrow';

/**
 * @param {import('./data-store.js').DataStore} dataStore
 * @param {import('./data-store.js').DataKeys | undefined } ids A list containing a combination of namespace ids, and namespace/document id tuples. If not provided, all documents will be matched.
 * @returns {import('neverthrow').Result<Iterable<import('./data-store.js').Document>, string>}
 */
export function getMatchingDocuments(dataStore, ids) {
	if (!ids) {
		return ok(dataStore.allDocuments());
	}

	return dataStore.filter(ids).map(results => results.map(result => result.documents).flat());
}

/**
 * Shared logic for content transforms
 * @param {object} params
 * @param {import('./data-store.js').DataStore} params.dataStore
 * @param {string} params.path
 * @param {(content: unknown) => unknown} params.transformFn
 * @param {import('@bluecadet/launchpad-utils').Logger} params.logger
 * @param {import('./data-store.js').DataKeys} [params.keys]
 */
export function applyTransformToFiles({ dataStore, path, transformFn, logger, keys }) {
	const pathStr = chalk.yellow(path);

	const matchingDocuments = getMatchingDocuments(dataStore, keys);

	if (matchingDocuments.isErr()) {
		return err(new Error(matchingDocuments.error));
	}

	for (const document of matchingDocuments.value) {
		logger.debug(
			chalk.gray(`Applying content transform to '${pathStr}' for key '${document.id}'`));

		const result = document.apply(path, transformFn);

		if (result.isErr()) {
			return err(result.error);
		}
	}

	return ok(undefined);
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
