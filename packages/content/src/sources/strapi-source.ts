import type { Logger } from "@bluecadet/launchpad-utils";
import { type ResultAsync, errAsync, ok, okAsync } from "neverthrow";
import qs from "qs";
import { fetchPaginated } from "../utils/fetch-paginated.js";
import { safeKy } from "../utils/safe-ky.js";
import { type ContentSource, SourceConfigError, SourceFetchError, defineSource } from "./source.js";

/**
 * @typedef StrapiObjectQuery
 * @property {string} contentType The content type to query
 * @property {{pagination?: {page: number, pageSize: number}, [key: string]: unknown}} params Query parameters. Uses `qs` library to stringify.
 */

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

type StrapiLoginCredentials = {
	/**
	 * Username or email. Should be configured via `./.env.local`
	 */
	identifier: string;
	/**
	 * Password. Should be configured via `./.env.local`
	 */
	password: string;
};

type StrapiTokenCredentials = {
	/**
	 * A previously generated JWT token.
	 */
	token: string;
};

export type StrapiCredentials = StrapiLoginCredentials | StrapiTokenCredentials;

export type BaseStrapiOptions = {
	/**
	 * Required field to identify this source. Will be used as download path.
	 */
	id: string;
	/**
	 * Versions `3` and `4` are supported. Defaults to `3`.
	 */
	version?: "3" | "4";
	/**
	 * The base url of your Strapi CMS (with or without trailing slash).
	 */
	baseUrl: string;
	/**
	 * Queries for each type of content you want to save. One per content type. Content will be stored as numbered, paginated JSONs.
	 * You can include all query parameters supported by Strapi.
	 * You can also pass an object with a `contentType` and `params` property, where `params` is an object of query parameters.
	 */
	queries: Array<string | StrapiObjectQuery>;
	/**
	 * Max number of entries per page. Defaults to `100`.
	 */
	limit?: number;
	/**
	 * Max number of pages. Use the default of `-1` for all pages. Defaults to `-1`.
	 */
	maxNumPages?: number;
	/**
	 * How many zeros to pad each json filename index with. Defaults to `0`.
	 */
	pageNumZeroPad?: number;
};

export type StrapiOptions = BaseStrapiOptions & StrapiCredentials;

export type StrapiOptionsAssembled = Required<BaseStrapiOptions> & StrapiCredentials;

const STRAPI_OPTION_DEFAULTS = {
	version: "3",
	limit: 100,
	maxNumPages: -1,
	pageNumZeroPad: 2,
} satisfies Partial<BaseStrapiOptions>;

class StrapiVersionUtils {
	protected config: StrapiOptionsAssembled;
	protected logger: Logger;

	constructor(config: StrapiOptionsAssembled, logger: Logger) {
		this.config = config;
		this.logger = logger;
	}

	buildUrl(query: StrapiObjectQuery, pagination?: StrapiPagination): string {
		throw new Error("Not implemented");
	}

	hasPaginationParams(query: StrapiObjectQuery): boolean {
		throw new Error("Not implemented");
	}

	transformResult(result: unknown): unknown[] {
		if (!Array.isArray(result)) {
			throw new Error("Expected result to be an array");
		}

		return result;
	}

	canFetchMore(result: unknown): boolean {
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
		return query?.params?.pagination?.page !== undefined || query?.params?.pagination?.pageSize !== undefined;
	}

	override transformResult(result: { data: unknown[] }): unknown[] {
		return result.data;
	}

	override canFetchMore(result: { meta?: { pagination?: { page: number; pageCount: number } } }): boolean {
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

function getJwt(baseUrl: string, identifier: string, password: string): ResultAsync<string, SourceFetchError> {
	const url = new URL("/auth/local", baseUrl);

	return safeKy(url.toString(), {
		method: "POST",
		json: { identifier, password },
	})
		.json()
		.map((response) => response.jwt)
		.mapErr((e) => new SourceFetchError(`Could not complete request to get JWT for ${identifier}`, { cause: e }));
}

function getToken(assembledOptions: StrapiOptionsAssembled): ResultAsync<string, SourceFetchError> {
	if ("token" in assembledOptions) {
		return okAsync(assembledOptions.token);
	}

	return getJwt(assembledOptions.baseUrl, assembledOptions.identifier, assembledOptions.password);
}

export default function strapiSource(options: StrapiOptions): ResultAsync<ContentSource, SourceConfigError> {
	const assembledOptions = {
		...STRAPI_OPTION_DEFAULTS,
		...options,
	};

	if (assembledOptions.version !== "4" && assembledOptions.version !== "3") {
		return errAsync(new SourceConfigError(`Unsupported strapi version '${assembledOptions.version}'`));
	}

	return getToken(assembledOptions).map((token) =>
		defineSource({
			id: options.id,
			fetch: (ctx) => {
				const versionUtils: StrapiVersionUtils =
					assembledOptions.version === "4" ? new StrapiV4(assembledOptions, ctx.logger) : new StrapiV3(assembledOptions, ctx.logger);

				const fetchPromises = assembledOptions.queries.map((query) => {
					let parsedQuery: StrapiObjectQuery;

					if (typeof query === "string") {
						parsedQuery = versionUtils.parseQuery(query);
					} else {
						parsedQuery = query;
					}

					return {
						id: parsedQuery.contentType,
						dataPromise: fetchPaginated({
							fetchPageFn: (params) => {
								const pageNum = params.offset / params.limit;

								if (pageNum > assembledOptions.maxNumPages && assembledOptions.maxNumPages !== -1) {
									return okAsync(null);
								}

								ctx.logger.debug(`Fetching page ${pageNum} of ${parsedQuery.contentType}`);

								return safeKy(
									versionUtils.buildUrl(parsedQuery, {
										start: params.offset,
										limit: params.limit,
									}),
									{
										headers: {
											Authorization: `Bearer ${token}`,
										},
									},
								)
									.json()
									.map((json) => {
										const transformedContent = versionUtils.transformResult(json);

										if (!transformedContent || !transformedContent.length) {
											return null;
										}

										return transformedContent;
									})
									.mapErr((e) => new SourceFetchError(`Could not fetch page ${pageNum} of ${parsedQuery.contentType}`, { cause: e }));
							},
							limit: assembledOptions.limit,
							logger: ctx.logger,
						}).map((data) => {
							return data.pages.map((page, i) => {
								const fileName = `${parsedQuery.contentType}-${(i + 1).toString().padStart(assembledOptions.pageNumZeroPad, "0")}.json`;
								return {
									id: fileName,
									data: page,
								};
							});
						}),
					};
				});

				return ok(fetchPromises);
			},
		}),
	);
}
