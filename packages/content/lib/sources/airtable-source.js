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

import { err, ok, Result } from 'neverthrow';
import { defineSource } from './source.js';

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

async function getAirtable() {
	// async import because it's an optional dependency
	try {
		const Airtable = await import('airtable');
		return ok(Airtable.default);
	} catch (error) {
		return err('Could not find module "airtable". Make sure you have installed it.');
	}
}

/**
 * Fetch data from Airtable.
 * @param {import("airtable").Base} base 
 * @param {string} tableId 
 * @param {string} [defaultView]
 */
async function fetchData(base, tableId, defaultView) {
	return new Promise((resolve) => {
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
						resolve(err(error));
					} else {
						resolve(ok(rows));
					}
				}
			);
	});
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
				return err('At least 2 columns required to map table to a key-value pair');
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

	return ok(simpData);
}

/**
 * @type {import("./source.js").ContentSourceBuilder<AirtableOptionsAssembled>}
 */
export default async function airtableSource(options) {
	const assembledOptions = {
		...AIRTABLE_OPTION_DEFAULTS,
		...options
	};

	const airtableResult = await getAirtable();

	if (airtableResult.isErr()) {
		return err(airtableResult.error);
	}

	const Airtable = airtableResult.value;

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
   */
	async function getDataCached(tableId, force = false, logger) {
		logger.debug(`Fetching ${tableId} from Airtable`);

		if (force) {
			rawAirtableDataCache[tableId] = [];
		}

		if (rawAirtableDataCache[tableId] && rawAirtableDataCache[tableId].length > 0) {
			logger.debug(`${tableId} found in cache`);
			return ok(rawAirtableDataCache[tableId]);
		}

		const data = await fetchData(base, tableId, assembledOptions.defaultView);

		if (data.isErr()) {
			logger.error(`Error fetching ${tableId} from Airtable: ${data.error}`);
			return err(data.error);
		}

		rawAirtableDataCache[tableId] = data.value;

		logger.debug(`${tableId} fetched from Airtable`);
		return ok(data.value);
	}

	return ok(defineSource({
		id: assembledOptions.id,
		fetch: async (ctx) => {
			const result = new Map();

			const tablePromises = [];
			const tableIds = [];

			for (const tableId of assembledOptions.tables) {
				tablePromises.push(getDataCached(tableId, false, ctx.logger));
				tableIds.push(tableId);
			}

			for (const tableId of assembledOptions.keyValueTables) {
				tablePromises.push(getDataCached(tableId, false, ctx.logger));
				tableIds.push(tableId);
			}

			const tables = await Promise.all(tablePromises);

			const results = Result.combine(tables);

			if (results.isErr()) {
				ctx.logger.error(`Error fetching tables from Airtable: ${results.error}`);
				return err(results.error);
			}

			for (let i = 0; i < tables.length; i++) {
				const table = results.value[i];
				const tableId = tableIds[i];
				result.set(`${tableId}.raw`, table);
				const simplifiedTable = await processTableToSimplified(table, assembledOptions.keyValueTables.includes(tableId));
				if (simplifiedTable.isErr()) {
					ctx.logger.error(`Error processing ${tableId} from Airtable: ${simplifiedTable.error}`);
					return err(simplifiedTable.error);
				}

				result.set(tableId, simplifiedTable.value);
			}

			return ok(result);
		}
	}));
}
