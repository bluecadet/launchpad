import { err, errAsync, ok, okAsync, ResultAsync, type Result } from "neverthrow";
import { defineSource, SourceConfigError, SourceFetchError, SourceMissingDependencyError, SourceParseError } from "./source.js";
import type Airtable from "airtable";
import type { Logger } from "@bluecadet/launchpad-utils";

type AirtableOptions = {
	/**
	 * Required field to identify this source. Will be used as download path.
	 */
	id: string;
	/**
	 * Airtable base ID. See https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base.
	 */
	baseId: string;
	/**
	 * The table view which to select for syncing by default. Defaults to 'Grid view'.
	 */
	defaultView?: string;
	/**
	 * The tables you want to fetch from. Defaults to [].
	 */
	tables?: string[];
	/**
	 * As a convenience feature, you can store tables listed here as key/value pairs. Field names should be `"key"` and `"value"`. Defaults to [].
	 */
	keyValueTables?: string[];
	/**
	 * The API endpoint to use for Airtable. Defaults to 'https://api.airtable.com'.
	 */
	endpointUrl?: string;
	/**
	 * Appends the local path of attachments to the saved JSON. Defaults to true.
	 */
	appendLocalAttachmentPaths?: boolean;
	/**
	 * Airtable API Key
	 */
	apiKey: string;
};

type AirtableOptionsAssembled = Required<AirtableOptions>;

const AIRTABLE_OPTION_DEFAULTS = {
	defaultView: "Grid view",
	tables: [],
	keyValueTables: [],
	endpointUrl: "https://api.airtable.com",
	appendLocalAttachmentPaths: true,
} satisfies Partial<AirtableOptions>;

/**
 * Fetch data from Airtable.
 */
function fetchData(base: Airtable.Base, tableId: string, defaultView: string): ResultAsync<Airtable.Record<Airtable.FieldSet>[], SourceFetchError> {
	return ResultAsync.fromPromise(
		new Promise((resolve, reject) => {
			const rows: Airtable.Record<Airtable.FieldSet>[] = [];

			base
				.table(tableId)
				.select({
					view: defaultView,
				})
				.eachPage(
					(records, fetchNextPage) => {
						// This function (`page`) will get called for each page of records.
						for (const record of records) {
							rows.push(record);
						}

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
					},
				);
		}),
		(error) => new SourceFetchError("Failed to fetch data from Airtable", { cause: error }),
	);
}

function isNumericStr(value: unknown) {
	return typeof value === "string" && !Number.isNaN(Number.parseFloat(value));
}

function isBoolStr(value: unknown) {
	return typeof value === "string" && (value === "true" || value === "false");
}

function processTableToSimplified(tableData: Airtable.Record<Airtable.FieldSet>[], isKeyValueTable: boolean): Result<unknown, SourceParseError> {
	if (isKeyValueTable) {
		// biome-ignore lint/suspicious/noExplicitAny: TODO
		const simplifiedData: Record<string, any> = {};

		for (const row of tableData) {
			const fields = row._rawJson.fields;

			if (Object.keys(fields).length < 2) {
				return err(new SourceParseError("At least 2 columns required to map table to a key-value pair"));
			}

			const regex = /(.*)\[([0-9]*)\]$/g;
			// Default to "key" | "value" if available.
			const keyField = Object.keys(fields).includes("key") ? "key" : Object.keys(fields)[0];
			const valueField = Object.keys(fields).includes("value") ? "value" : Object.keys(fields)[1];
			const key = fields[keyField as string];
			const value = fields[valueField as string];

			const matches = key ? [...key.matchAll(regex)] : [];
			if (matches.length > 0) {
				if (!simplifiedData[matches[0][1]]) {
					simplifiedData[matches[0][1]] = [];
				}
				simplifiedData[matches[0][1]][matches[0][2]] = value;
			} else if (isNumericStr(value)) {
				simplifiedData[key] = Number.parseFloat(value);
			} else if (isBoolStr(value)) {
				simplifiedData[key] = value === "true";
			} else {
				simplifiedData[key] = value;
			}
		}

		return ok(simplifiedData);
	}

	return ok(
		tableData.map((row) => ({
			id: row.id,
			...row._rawJson.fields,
		})),
	);
}

export default function airtableSource(options: AirtableOptions) {
	const assembledOptions = {
		...AIRTABLE_OPTION_DEFAULTS,
		...options,
	};

	if (!assembledOptions.apiKey) {
		return errAsync(new SourceConfigError("apiKey is required"));
	}

	if (!assembledOptions.baseId) {
		return errAsync(new SourceConfigError("baseId is required"));
	}

	return ResultAsync.fromPromise(
		import("airtable"),
		() => new SourceMissingDependencyError('Could not find module "airtable". Make sure you have installed it.'),
	).map(({ default: Airtable }) => {
		Airtable.configure({
			endpointUrl: assembledOptions.endpointUrl,
			apiKey: assembledOptions.apiKey,
		});

		const base = Airtable.base(assembledOptions.baseId);

		const rawAirtableDataCache: Record<string, Airtable.Record<Airtable.FieldSet>[]> = {};

		function getDataCached(tableId: string, force: boolean, logger: Logger): ResultAsync<Airtable.Record<Airtable.FieldSet>[], SourceFetchError> {
			logger.debug(`Fetching ${tableId} from Airtable`);

			if (force) {
				rawAirtableDataCache[tableId] = [];
			}

			if (rawAirtableDataCache[tableId] && rawAirtableDataCache[tableId].length > 0) {
				logger.debug(`${tableId} found in cache`);
				return okAsync(rawAirtableDataCache[tableId]);
			}

			return fetchData(base, tableId, assembledOptions.defaultView).andTee((value) => {
				rawAirtableDataCache[tableId] = value as Airtable.Record<Airtable.FieldSet>[];
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
						dataPromise: getDataCached(tableId, false, ctx.logger).andThen((data) => {
							const simplifiedTable = processTableToSimplified(data, false);

							if (simplifiedTable.isErr()) {
								ctx.logger.error(`Error processing ${tableId} from Airtable`);
								return err(new SourceParseError(`Error processing table ${tableId} from Airtable`, { cause: simplifiedTable.error }));
							}

							return ok([
								{
									id: `${tableId}.raw`,
									data,
								},
								{
									id: tableId,
									data: simplifiedTable.value,
								},
							]);
						}),
					});
				}

				for (const tableId of assembledOptions.keyValueTables) {
					tablePromises.push({
						id: tableId,
						dataPromise: getDataCached(tableId, false, ctx.logger).andThen((data) => {
							const simplifiedTable = processTableToSimplified(data, true);

							if (simplifiedTable.isErr()) {
								ctx.logger.error(`Error processing ${tableId} from Airtable`);
								return err(new SourceParseError(`Error processing table ${tableId} from Airtable`, { cause: simplifiedTable.error }));
							}

							return ok([
								{
									id: `${tableId}.raw`,
									data,
								},
								{
									id: tableId,
									data: simplifiedTable.value,
								},
							]);
						}),
					});
				}

				return ok(tablePromises);
			},
		});
	});
}
