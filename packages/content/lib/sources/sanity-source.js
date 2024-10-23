import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow';
import { defineSource } from './source.js';
import { fetchPaginated } from '../utils/fetch-paginated.js';
import { configError, fetchError } from './source-errors.js';

/**
 * @typedef BaseSanityOptions
 * @property {string} id Required field to identify this source. Will be used as download path.
 * @property {string} [apiVersion] API Version. Defailts to 'v2021-10-21'
 * @property {string} projectId Sanity Project ID
 * @property {string} apiToken API Token defined in your sanity project.
 * @property {string} [dataset] Dataset. Defaults to 'production'
 * @property {boolean} [useCdn] `false` if you want to ensure fresh data
 * @property {string} baseUrl The base url of your Sanity CMS (with or without trailing slash).
 * @property {Array<string | {query: string, id: string}>} queries An array of queries to fetch. Each query can be a string or an object with a query and an id.
 * @property {number} [limit] Max number of entries per page. Defaults to 100.
 * @property {number} [maxNumPages] Max number of pages. Use `-1` for all pages. Defaults to -1.
 * @property {boolean} [mergePages] To combine paginated files into a single file. Defaults to false.
 * @property {number} [pageNumZeroPad] How many zeros to pad each json filename index with. Defaults to 0.
 */

const SANITY_OPTION_DEFAULTS = {
  apiVersion: 'v2021-10-21',
  dataset: 'production',
  useCdn: false,
  limit: 100,
  maxNumPages: -1,
  mergePages: true,
  pageNumZeroPad: 0,
  appendCroppedFilenames: true
};

/**
 * @type {import("./source.js").ContentSourceBuilder<BaseSanityOptions>}
 */
export default function sanitySource(options) {
  if (!options.projectId || !options.apiToken) {
    return errAsync(configError('Missing projectId and/or apiToken'));
  }

  const assembledOptions = {
    ...SANITY_OPTION_DEFAULTS,
    ...options
  };

  return ResultAsync.fromPromise(import('@sanity/client'), () => configError('Could not find "@sanity/client". Make sure you have installed it.'))
    .andThen(({ createClient }) => {
      const sanityClient = createClient({
        projectId: assembledOptions.projectId,
        dataset: assembledOptions.dataset,
        apiVersion: assembledOptions.apiVersion, // use current UTC date - see "specifying API version"!
        token: assembledOptions.apiToken, // or leave blank for unauthenticated usage
        useCdn: assembledOptions.useCdn // `false` if you want to ensure fresh data);
      });

      return ok(defineSource({
        id: options.id,
        fetch: (ctx) => {
          /**
           * @type {Array<ReturnType<typeof fetchPaginated<unknown, {key: string}>>>}
           */
          const queryPromises = [];

          for (const query of assembledOptions.queries) {
            if (typeof query === 'string') {
              const queryFull = '*[_type == "' + query + '" ]';

              queryPromises.push(
                fetchPaginated({
                  fetchPageFn: (params) => {
                    const q = `${queryFull}[${params.offset}..${params.offset + params.limit - 1}]`;
                    return ResultAsync.fromPromise(sanityClient.fetch(q), (e) => fetchError(`Could not fetch page with query: '${q}'`));
                  },
                  limit: assembledOptions.limit,
                  logger: ctx.logger,
                  meta: {
                    key: query
                  }
                })
              );
            } else if (typeof query === 'object' && query.query && query.id) {
              queryPromises.push(
                fetchPaginated({
                  fetchPageFn: (params) => {
                    const q = `${query.query}[${params.offset}..${params.offset + params.limit - 1}]`;
                    return ResultAsync.fromPromise(sanityClient.fetch(q), (e) => fetchError(`Could not fetch page with query: '${q}'`));
                  },
                  limit: assembledOptions.limit,
                  logger: ctx.logger,
                  meta: {
                    key: query.id
                  }
                })
              );
            } else {
              ctx.logger.error(`Invalid query: ${query}`);
              return errAsync(configError(`Invalid query: ${query}`));
            }
          }

          return ResultAsync.combine(queryPromises).andThen(allFetches => {
            /**
             * @type {Map<string, unknown>}
             */
            const resultMap = new Map();

            for (const result of allFetches) {
              if (assembledOptions.mergePages) {
                const combinedResult = result.pages.flat(1);

                resultMap.set(result.meta.key, combinedResult);
              } else {
                for (let i = 0; i < result.pages.length; i++) {
                  const pageNum = i + 1;
                  const keyWithPageNum = `${result.meta.key}-${pageNum
                    .toString()
                    .padStart(assembledOptions.pageNumZeroPad, '0')}`;

                  resultMap.set(keyWithPageNum, result.pages[i]);
                }
              }
            }

            return ok(resultMap);
          });
        }
      }));
    });
}
