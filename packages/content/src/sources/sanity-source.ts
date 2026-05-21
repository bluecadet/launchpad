import { z } from "zod";
import { defineSource } from "../source.js";
import { fetchPaginated } from "../utils/fetch-paginated.js";

const sanitySourceSchema = z.object({
	/** Required field to identify this source. Will be used as download path. */
	id: z.string().describe("Required field to identify this source. Will be used as download path."),
	/** Sanity API Version. Defaults to 'v2021-10-21' */
	apiVersion: z.string().describe("Sanity API Version").default("v2021-10-21"),
	/** Sanity API Token. Required if dataset is private. */
	apiToken: z.string().describe("Sanity API Token. Required if dataset is private.").optional(),
	/** Sanity Project ID */
	projectId: z.string().describe("Sanity Project ID"),
	/** Sanity Dataset. Defaults to 'production' */
	dataset: z.string().describe("Sanity Dataset").default("production"),
	/** `false` if you want to ensure fresh data */
	useCdn: z.boolean().describe("`false` if you want to ensure fresh data").default(true),
	/** An array of queries to fetch. Each query can be a string or an object with a query and an id. */
	queries: z
		.array(z.union([z.string(), z.object({ query: z.string(), id: z.string() })]))
		.describe(
			"An array of queries to fetch. Each query can be a string or an object with a query and an id.",
		),
	/** Max number of entries per page. Defaults to 100. */
	limit: z.number().describe("Max number of entries per page").default(100),
	/** Max number of pages. Defaults to 1000. */
	maxNumPages: z.number().describe("Max number of pages").default(1000),
	/** To combine paginated files into a single file. Defaults to false. */
	mergePages: z.boolean().describe("To combine paginated files into a single file.").default(false),
});

export default async function sanitySource(options: z.input<typeof sanitySourceSchema>) {
	const parsedOptions = sanitySourceSchema.parse(options);

	const { createClient } = await tryImportSanityClient();

	const sanityClient = createClient({
		projectId: parsedOptions.projectId,
		dataset: parsedOptions.dataset,
		apiVersion: parsedOptions.apiVersion,
		token: parsedOptions.apiToken,
		useCdn: parsedOptions.useCdn,
	});

	return defineSource({
		id: parsedOptions.id,
		fetch: (ctx) => {
			return parsedOptions.queries.map((query) => {
				let fullQuery: string;
				let id: string;
				if (typeof query === "string") {
					fullQuery = `*[_type == "${query}"]`;
					id = query;
				} else {
					fullQuery = query.query;
					id = query.id;
				}

				// if full query already contains a number range, no need to paginate
				if (fullQuery.match(/\[\d+(\.\.\d+)?\]/)) {
					ctx.logger.verbose(
						`Query '${fullQuery}' already contains a number range. No pagination.`,
					);
					return {
						id,
						data: sanityClient.fetch<unknown>(
							fullQuery,
							{},
							{
								signal: ctx.abortSignal,
							},
						),
					};
				}

				return {
					id,
					data: fetchPaginated({
						limit: parsedOptions.limit,
						logger: ctx.logger,
						maxFetchCount: parsedOptions.maxNumPages,
						mergePages: parsedOptions.mergePages,
						fetchPageFn: (params) => {
							// construct paginated query with groq syntax
							const q = `${fullQuery}[${params.offset}..${params.offset + params.limit - 1}]`;

							try {
								return sanityClient.fetch<unknown>(
									q,
									{},
									{
										signal: ctx.abortSignal,
									},
								);
							} catch (e) {
								throw new Error(`Could not fetch page with query: '${q}'`, { cause: e });
							}
						},
					}),
				};
			});
		},
	});
}

function tryImportSanityClient() {
	try {
		return import("@sanity/client");
	} catch (e) {
		throw new Error(
			'Could not find peer dependency "@sanity/client". Make sure you have installed it.',
			{ cause: e },
		);
	}
}
