import chalk from 'chalk';

/**
 * Shared logic for content transforms
 * @param {object} params
 * @param {import('./data-store.js').default} params.dataStore
 * @param {string} params.path
 * @param {(content: unknown) => unknown} params.transformFn
 * @param {import('@bluecadet/launchpad-utils').Logger} params.logger
 * @param {string[]} [params.keys]
 */
export function applyTransformToFiles({ dataStore, path, transformFn, logger, keys }) {
	const pathStr = chalk.yellow(path);

	// if no keys are provided, iterate over all keys in the data store
	const keysToIterate = keys ?? dataStore.keys();

	for (const key of keysToIterate) {
		logger.debug(
			chalk.gray(`Applying content transform to '${pathStr}' for key '${key}'`));

		const result = dataStore.apply(key, path, transformFn);

		if (result.isErr()) {
			logger.error(
				chalk.red(`Could not apply content transform to '${pathStr}' for key '${key}'`)
			);
			logger.error(result.error);
		} else {
			logger.debug(
				chalk.green(`Content transform applied to '${pathStr}' for key '${key}'`)
			);
		}
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
