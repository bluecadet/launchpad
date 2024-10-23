import { err, ok, okAsync, Result, ResultAsync } from 'neverthrow';
import { defineSource } from './source.js';
import { configError, fetchError, parseError } from './source-errors.js';

/**
 * @typedef AirtableOptions
 * @property {string} id Required field to identify this source. Will be used as download path.
 * @property {string} baseId Airtable base ID. See https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base.
 * @property {string} [defaultView] The table view which to select for syncing by default. Defaults to 'Grid view'.
 * @property {string[]} [tables] The tables you want to fetch from. Defaults to [].
 * @property {string[]} [keyValueTables] As a convenience feature, you can store tables listed here as key/value pairs. Field names should be `"key"` and `"value"`. Defaults to [].
 * @property {string} [endpointUrl] The API endpoint to use for Airtable. Defaults to 'https://api.airtable.com'.
 * @property {boolean} [appendLocalAttachmentPaths] Appends the local path of attachments to the saved JSON. Defaults to true.
 * @property {string} apiKey Airtable API Key
 */

/**
 * @typedef {Required<AirtableOptions>} AirtableOptionsAssembled
 */

/**
 * @satisfies {Partial<AirtableOptions>}
 */
const AIRTABLE_OPTION_DEFAULTS = {
	defaultView: 'Grid view',
	tables: [],
	keyValueTables: [],
	endpointUrl: 'https://api.airtable.com',
	appendLocalAttachmentPaths: true
};

/**
 * Fetch data from Airtable.
 * @param {import("airtable").Base} base 
 * @param {string} tableId 
 * @param {string} [defaultView]
 * @returns {ResultAsync<import("airtable").Record<import("airtable").FieldSet>[], import('./source-errors.js').SourceError>}
 */
function fetchData(base, tableId, defaultView) {
	return ResultAsync.fromPromise(
		new Promise((resolve, reject) => {
			/**
			 * @type {import("airtable").Record<import("airtable").FieldSet>[]}
			 */
			const rows = [];

			base(tableId)
				.select({
					view: defaultView
				})
				.eachPage(
					(records, fetchNextPage) => {
						// This function (`page`) will get called for each page of records.
						records.forEach((record) => {
							rows.push(record);
						});

						// To fetch the next page of records, call `fetchNextPage`.
						// If there are more records, `page` will get called again.
						// If there are no more records, `done` will get called.
						fetchNextPage();
					},
					(error) => {
						if (error) {
							reject(error);
						} else {
							resolve(rows);
						}
					}
				);
		}),
		(error) => fetchError(`Failed to fetch data from Airtable: ${error instanceof Error ? error.message : error}`)
	);
}

/**
 * @param {unknown} value
 */
function isNumericStr(value) {
	return typeof value === 'string' && !isNaN(parseFloat(value));
}

/**
 * @param {unknown} value
 */
function isBoolStr(value) {
	return typeof value === 'string' && (value === 'true' || value === 'false');
}

/**
 * @param {import("airtable").Record<import("airtable").FieldSet>[]} tableData 
 * @param {boolean} isKeyValueTable
 */
function processTableToSimplified(tableData, isKeyValueTable) {
	/**
	 * @type {Record<string | number, any>}
	 */
	const simpData = isKeyValueTable ? {} : [];

	for (const row of tableData) {
		const fields = { ...row._rawJson.fields };
		if (isKeyValueTable) {
			if (Object.keys(row).length < 2) {
				return err(parseError('At least 2 columns required to map table to a key-value pair'));
			}

			const regex = /(.*)\[([0-9]*)\]$/g;
			// Default to "key" | "value" if available.
			const keyField = Object.keys(fields).includes('key') ? 'key' : Object.keys(fields)[0];
			const valueField = Object.keys(fields).includes('value') ? 'value' : Object.keys(fields)[1];
			const key = fields[keyField];
			const value = fields[valueField];

			const matches = key ? [...key.matchAll(regex)] : [];
			if (matches.length > 0) {
				if (!simpData[matches[0][1]]) {
					simpData[matches[0][1]] = [];
				}
				simpData[matches[0][1]][matches[0][2]] = value;
			} else if (isNumericStr(value)) {
				simpData[key] = parseFloat(value);
			} else if (isBoolStr(value)) {
				simpData[key] = value === 'true';
			} else {
				simpData[key] = value;
			}
		} else {
			simpData.push({ id: row.id, ...fields });
		}
	}

	return simpData;
}

/**
 * @type {import("./source.js").ContentSourceBuilder<AirtableOptionsAssembled>}
 */
export default function airtableSource(options) {
	const assembledOptions = {
		...AIRTABLE_OPTION_DEFAULTS,
		...options
	};

	return ResultAsync.fromPromise(import('airtable'), () => configError('Could not find module "airtable". Make sure you have installed it.'))
		.map(({ default: Airtable }) => {
			Airtable.configure({
				endpointUrl: assembledOptions.endpointUrl,
				apiKey: assembledOptions.apiKey
			});

			const base = Airtable.base(assembledOptions.baseId);
			base.makeRequest();

			/**
			 * @type {Record<string, import("airtable").Record<import("airtable").FieldSet>[]>}
			 */
			const rawAirtableDataCache = {};

			/**
			 * @param {string} tableId 
			 * @param {boolean} force
			 * @param {import("@bluecadet/launchpad-utils").Logger} logger
			 * @returns {ResultAsync<import("airtable").Record<import("airtable").FieldSet>[], import('./source-errors.js').SourceError>}
			 */
			function getDataCached(tableId, force = false, logger) {
				logger.debug(`Fetching ${tableId} from Airtable`);

				if (force) {
					rawAirtableDataCache[tableId] = [];
				}

				if (rawAirtableDataCache[tableId] && rawAirtableDataCache[tableId].length > 0) {
					logger.debug(`${tableId} found in cache`);
					return okAsync(rawAirtableDataCache[tableId]);
				}

				return fetchData(base, tableId, assembledOptions.defaultView).andTee(value => {
					rawAirtableDataCache[tableId] = value;
					logger.debug(`${tableId} fetched from Airtable`);
				});
			}

			return defineSource({
				id: assembledOptions.id,
				fetch: (ctx) => {
					/**
					 * @type {Array<import('./source.js').SourceFetchPromise>}
					 */
					const tablePromises = [];

					for (const tableId of assembledOptions.tables) {
						tablePromises.push({
							id: tableId,
							dataPromise: getDataCached(tableId, false, ctx.logger).andThen(data => {
								const simplifiedTable = processTableToSimplified(data, false);

								if (simplifiedTable.isErr()) {
									ctx.logger.error(`Error processing ${tableId} from Airtable: ${simplifiedTable.error}`);
									return err(simplifiedTable.error);
								}

								return ok([{
									id: `${tableId}.raw`,
									data: data
								}, {
									id: tableId,
									data: simplifiedTable
								}]);
							})
						})
					}

					for (const tableId of assembledOptions.keyValueTables) {
						tablePromises.push({
							id: tableId,
							dataPromise: getDataCached(tableId, false, ctx.logger).andThen(data => {
								const simplifiedTable = processTableToSimplified(data, true);

								if (simplifiedTable.isErr()) {
									ctx.logger.error(`Error processing ${tableId} from Airtable: ${simplifiedTable.error}`);
									return err(simplifiedTable.error);
								}

								return ok([{
									id: `${tableId}.raw`,
									data: data
								}, {
									id: tableId,
									data: simplifiedTable
								}]);
							})
						})
					}

					return ok(tablePromises);
				}
			});
		});
}
