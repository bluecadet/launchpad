import jsonpath from 'jsonpath';
import chalk from 'chalk';
import { DataFile } from '../content-sources/content-result.js';

/**
 * @param {object} params
 * @param {DataFile[]} params.dataFiles
 * @param {string} params.path
 * @param {(content: unknown) => unknown} params.transformFn
 * @param {import('@bluecadet/launchpad-utils').Logger} params.logger
 */
export function applyTransformToFiles({ dataFiles, path, transformFn, logger }) {
	const pathStr = chalk.yellow(path);
  
	return dataFiles.map((data) => {
		const localPathStr = chalk.yellow(data.localPath);

		try {
			logger.debug(
				chalk.gray(`Applying content transform to '${pathStr}' in ${localPathStr}`));
              
			jsonpath.apply(data.content, path, transformFn);

			return data;
		} catch (err) {
			logger.error(
				chalk.red(`Could not apply content transform to '${pathStr}' in ${localPathStr}`)
			);
			logger.error(err);

			return data;
		}
	});
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
