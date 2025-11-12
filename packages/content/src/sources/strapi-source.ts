import type { Logger } from "@bluecadet/launchpad-utils/logger";
import ky from "ky";
import qs from "qs";
import { z } from "zod";
import { defineSource } from "../source.js";
import { fetchPaginated } from "../utils/fetch-paginated.js";

const strapiCredentialsSchema = z.union(
	[
		z.object({
			/** Username or email. Should be configured via `./.env.local` */
			identifier: z.string().describe("Username or email. Should be configured via `./.env.local`"),
			/** Password. Should be configured via `./.env.local` */
			password: z.string().describe("Password. Should be configured via `./.env.local`"),
		}),
		z.object({
			/** A previously generated JWT token. */
			token: z.string().describe("A previously generated JWT token."),
		}),
	],
	{
		errorMap: (error) => {
			if (error.code === "invalid_union")
				return {
					message: "Either `identifier` and `password` OR a `token` must be provided.",
				};

			return { message: error.message ?? "" };
		},
	},
);

const strapiSourceSchema = z
	.object({
		/** Required field to identify this source. Will be used as download path. */
		id: z
			.string()
			.describe("Required field to identify this source. Will be used as download path."),
		/** Strapi version. Defaults to `3`. */
		version: z.enum(["3", "4"]).describe("Strapi version").default("3"),
		/** The base url of your Strapi CMS (with or without trailing slash). */
		baseUrl: z
			.string()
			.describe("The base url of your Strapi CMS (with or without trailing slash)."),
		/**
		 * Queries for each type of content you want to save. One per content type. Content will be stored as numbered, paginated JSONs.
		 * You can include all query parameters supported by Strapi.
		 * You can also pass an object with a `contentType` and `params` property, where `params` is an object of query parameters.
		 */
		queries: z
			.array(
				z.union([z.string(), z.object({ contentType: z.string(), params: z.record(z.any()) })]),
			)
			.describe(
				"Queries for each type of content you want to save. One per content type. Content will be stored as numbered, paginated JSONs. \
			You can include all query parameters supported by Strapi. \
			You can also pass an object with a `contentType` and `params` property, where `params` is an object of query parameters.",
			),
		/** Max number of entries per page. Defaults to `100`. */
		limit: z.number().describe("Max number of entries per page").default(100),
		/** Max number of pages. Defaults to `1000`. */
		maxNumPages: z.number().describe("Max number of pages").default(1000),
		/** How many zeros to pad each json filename index with. Defaults to `2`. */
		pageNumZeroPad: z
			.number()
			.describe("How many zeros to pad each json filename index with")
			.default(2),
	})
	.and(strapiCredentialsSchema);

type StrapiSourceSchemaOutput = z.output<typeof strapiSourceSchema>;

type StrapiObjectQuery = {
	/**
	 * the content type to query
	 */
	contentType: string;
	/**
	 * query parameters. Uses `qs` library to stringify.
	 */
	params: { pagination?: { page: number; pageSize: number }; [key: string]: unknown };
};

type StrapiPagination = {
	/**
	 * The index of the first item to fetch
	 */
	start: number;
	/**
	 * The number of items to fetch
	 */
	limit: number;
};

class StrapiVersionUtils {
	protected config: StrapiSourceSchemaOutput;
	protected logger: Logger;

	constructor(config: StrapiSourceSchemaOutput, logger: Logger) {
		this.config = config;
		this.logger = logger;
	}

	buildUrl(_query: StrapiObjectQuery, _pagination?: StrapiPagination): string {
		throw new Error("Not implemented");
	}

	hasPaginationParams(_query: StrapiObjectQuery): boolean {
		throw new Error("Not implemented");
	}

	transformResult(result: unknown): unknown[] {
		if (!Array.isArray(result)) {
			throw new Error("Expected result to be an array");
		}

		return result;
	}

	canFetchMore(_result: unknown): boolean {
		throw new Error("Not implemented");
	}

	parseQuery(string: string): StrapiObjectQuery {
		const url = new URL(string, this.config.baseUrl);
		const params = qs.parse(url.search.slice(1));
		const contentType = url.pathname.split("/").pop();

		if (contentType === undefined) {
			throw new Error(`Could not parse content type from query '${string}'`);
		}

		return { contentType, params };
	}
}

class StrapiV4 extends StrapiVersionUtils {
	override buildUrl(query: StrapiObjectQuery, pagination?: StrapiPagination): string {
		const url = new URL(`/api/${query.contentType}`, this.config.baseUrl);

		let params = query.params;

		// only add pagination params if they arent't specified in the query object
		if (!this.hasPaginationParams(query) && pagination) {
			params = {
				...params,
				pagination: {
					page: pagination.start / pagination.limit + 1,
					pageSize: pagination.limit,
					...params?.pagination,
				},
			};
		}

		const search = qs.stringify(params, {
			encodeValuesOnly: true, // prettify url
			addQueryPrefix: true, // add ? to beginning
		});

		url.search = search;

		return url.toString();
	}

	override hasPaginationParams(query: StrapiObjectQuery): boolean {
		return (
			query?.params?.pagination?.page !== undefined ||
			query?.params?.pagination?.pageSize !== undefined
		);
	}

	override transformResult(result: { data: unknown[] }): unknown[] {
		return result.data;
	}

	override canFetchMore(result: {
		meta?: { pagination?: { page: number; pageCount: number } };
	}): boolean {
		if (result?.meta?.pagination) {
			const { page, pageCount } = result.meta.pagination;
			return page < pageCount;
		}

		return false;
	}
}

class StrapiV3 extends StrapiVersionUtils {
	override buildUrl(query: StrapiObjectQuery, pagination?: StrapiPagination): string {
		const url = new URL(`/api/${query.contentType}`, this.config.baseUrl);

		let params = query.params;

		// only add pagination params if they arent't specified in the query object
		if (!this.hasPaginationParams(query) && pagination) {
			params = {
				_start: pagination.start,
				_limit: pagination.limit,
				...params,
			};
		}

		const search = qs.stringify(params, {
			encodeValuesOnly: true, // prettify url
			addQueryPrefix: true, // add ? to beginning
		});

		url.search = search;

		return url.toString();
	}

	override hasPaginationParams(query: StrapiObjectQuery): boolean {
		return query?.params?._start !== undefined || query?.params?._limit !== undefined;
	}

	override canFetchMore() {
		// strapi v3 doesn't have any pagination info in the response,
		// so we can't know if there are more results
		return true;
	}
}

async function getToken(assembledOptions: StrapiSourceSchemaOutput) {
	if ("token" in assembledOptions) {
		return assembledOptions.token;
	}

	const url = new URL("/auth/local", assembledOptions.baseUrl);
	const response = await ky.post<{ jwt: string }>(url.toString(), {
		json: { identifier: assembledOptions.identifier, password: assembledOptions.password },
	});

	return response.json().then((json) => json.jwt);
}

export default async function strapiSource(options: z.input<typeof strapiSourceSchema>) {
	const majorNodeVersion = Number.parseInt(process.versions.node.split(".")?.[0] ?? "0");

	if (majorNodeVersion < 20) {
		throw new Error(
			`Unsupported node version ${process.versions.node}. Strapi source requires node >= 20.`,
		);
	}

	const assembledOptions = strapiSourceSchema.parse(options);

	if (assembledOptions.version !== "4" && assembledOptions.version !== "3") {
		throw new Error(`Unsupported strapi version '${assembledOptions.version}'`);
	}

	const token = await getToken(assembledOptions);

	return defineSource({
		id: assembledOptions.id,
		fetch: (ctx) => {
			const versionUtils: StrapiVersionUtils =
				assembledOptions.version === "4"
					? new StrapiV4(assembledOptions, ctx.logger)
					: new StrapiV3(assembledOptions, ctx.logger);

			return assembledOptions.queries.map((query) => {
				let parsedQuery: StrapiObjectQuery;

				if (typeof query === "string") {
					parsedQuery = versionUtils.parseQuery(query);
				} else {
					parsedQuery = query;
				}

				return {
					id: parsedQuery.contentType,
					data: fetchPaginated({
						fetchPageFn: async (params) => {
							const pageNum = params.offset / params.limit;

							ctx.logger.debug(`Fetching page ${pageNum} of ${parsedQuery.contentType}`);

							const response = await ky
								.get(
									versionUtils.buildUrl(parsedQuery, {
										start: params.offset,
										limit: params.limit,
									}),
									{
										headers: {
											Authorization: `Bearer ${token}`,
										},
										signal: ctx.abortSignal,
									},
								)
								.json();

							const transformedContent = versionUtils.transformResult(response);

							if (!transformedContent || !transformedContent.length) {
								return null; // trigger end of pagination
							}

							return transformedContent;
						},
						maxFetchCount: assembledOptions.maxNumPages,
						limit: assembledOptions.limit,
						logger: ctx.logger,
					}),
				};
			});
		},
	});
}
