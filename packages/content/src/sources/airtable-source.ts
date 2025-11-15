import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type Airtable from "airtable";
import { z } from "zod";
import { defineSource } from "../source.js";

const airtableSourceSchema = z.object({
	/** Required field to identify this source. Will be used as download path. */
	id: z.string().describe("Required field to identify this source. Will be used as download path."),
	/** Airtable base ID. See https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base. */
	baseId: z
		.string()
		.describe(
			"Airtable base ID. See https://help.appsheet.com/en/articles/1785063-using-data-from-airtable#:~:text=To%20obtain%20the%20ID%20of,API%20page%20of%20the%20base.",
		),
	/** The table view which to select for syncing by default. Defaults to 'Grid view'. */
	defaultView: z
		.string()
		.describe("The table view which to select for syncing by default. Defaults to 'Grid view'.")
		.default("Grid view"),
	/** The tables you want to fetch from. Defaults to []. */
	tables: z
		.array(z.string())
		.describe("The tables you want to fetch from. Defaults to [].")
		.default([]),
	/** As a convenience feature, you can store tables listed here as key/value pairs. Field names should be `key` and `value`. Defaults to []. */
	keyValueTables: z
		.array(z.string())
		.describe(
			"As a convenience feature, you can store tables listed here as key/value pairs. Field names should be `key` and `value`. Defaults to [].",
		)
		.default([]),
	/** The API endpoint to use for Airtable. Defaults to 'https://api.airtable.com'. */
	endpointUrl: z
		.string()
		.describe("The API endpoint to use for Airtable. Defaults to 'https://api.airtable.com'.")
		.default("https://api.airtable.com"),
	/** Appends the local path of attachments to the saved JSON. Defaults to true. */
	appendLocalAttachmentPaths: z
		.boolean()
		.describe("Appends the local path of attachments to the saved JSON. Defaults to true.")
		.default(true),
	/** Airtable API Key */
	apiKey: z.string().describe("Airtable API Key"),
});

/**
 * Fetch data from Airtable.
 */
function fetchData(
	base: Airtable.Base,
	tableId: string,
	defaultView: string,
): Promise<Airtable.Record<Airtable.FieldSet>[]> {
	const rows: Airtable.Record<Airtable.FieldSet>[] = [];

	return new Promise((resolve, reject) =>
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
			),
	);
}

function isNumericStr(value: unknown) {
	return typeof value === "string" && !Number.isNaN(Number.parseFloat(value));
}

function isBoolStr(value: unknown) {
	return typeof value === "string" && (value === "true" || value === "false");
}

function processTableToSimplified(
	tableData: Airtable.Record<Airtable.FieldSet>[],
	isKeyValueTable: boolean,
): unknown {
	if (isKeyValueTable) {
		// biome-ignore lint/suspicious/noExplicitAny: TODO
		const simplifiedData: Record<string, any> = {};

		for (const row of tableData) {
			const fields = row._rawJson.fields;

			if (Object.keys(fields).length < 2) {
				throw new Error("At least 2 columns required to map table to a key-value pair");
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

		return simplifiedData;
	}

	return tableData.map((row) => ({
		id: row.id,
		...row._rawJson.fields,
	}));
}

export default async function airtableSource(options: z.input<typeof airtableSourceSchema>) {
	const assembledOptions = airtableSourceSchema.parse(options);

	const { default: Airtable } = await tryImportAirtable();

	Airtable.configure({
		endpointUrl: assembledOptions.endpointUrl,
		apiKey: assembledOptions.apiKey,
	});

	const base = Airtable.base(assembledOptions.baseId);

	const rawAirtableDataCache: Record<string, Airtable.Record<Airtable.FieldSet>[]> = {};

	async function getDataCached(
		tableId: string,
		force: boolean,
		logger: Logger,
	): Promise<Airtable.Record<Airtable.FieldSet>[]> {
		logger.verbose(`Fetching ${tableId} from Airtable`);

		if (force) {
			rawAirtableDataCache[tableId] = [];
		}

		if (rawAirtableDataCache[tableId] && rawAirtableDataCache[tableId].length > 0) {
			logger.verbose(`${tableId} found in cache`);
			return rawAirtableDataCache[tableId];
		}

		const data = await fetchData(base, tableId, assembledOptions.defaultView);
		rawAirtableDataCache[tableId] = data;
		logger.verbose(`${tableId} fetched from Airtable`);
		return data;
	}

	return defineSource({
		id: assembledOptions.id,
		fetch: (ctx) => {
			const documentFetches: Array<{ id: string; data: Promise<unknown> }> = [];

			for (const tableId of assembledOptions.tables) {
				documentFetches.push({
					id: tableId,
					data: getDataCached(tableId, false, ctx.logger).then((data) => {
						const simplifiedTable = processTableToSimplified(data, false);

						return simplifiedTable;
					}),
				});
			}

			for (const tableId of assembledOptions.keyValueTables) {
				documentFetches.push({
					id: tableId,
					data: getDataCached(tableId, false, ctx.logger).then((data) => {
						const simplifiedTable = processTableToSimplified(data, true);

						return simplifiedTable;
					}),
				});
			}

			return documentFetches;
		},
	});
}

function tryImportAirtable() {
	try {
		return import("airtable");
	} catch (e) {
		throw new Error('Could not find peer dependency "airtable". Make sure you have installed it.', {
			cause: e,
		});
	}
}
