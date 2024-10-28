import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import sanitySource from '../sanity-source.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';
import { DataStore } from '../../utils/data-store.js';

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
	vi.useFakeTimers({
		shouldAdvanceTime: true
	});
});
afterAll(() => {
	server.close();
	vi.useRealTimers();
});
afterEach(() => server.resetHandlers());

function createFetchContext() {
	return {
		logger: createMockLogger(),
		dataStore: new DataStore()
	};
}

describe('sanitySource', () => {
	it('should fail with missing required options', async () => {
		// @ts-expect-error - testing invalid options
		const result = await sanitySource({
			id: 'test-sanity'
			// missing projectId and apiToken
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().type).toBe('config');
		expect(result._unsafeUnwrapErr().message).toContain('Missing projectId and/or apiToken');
	});

	it('should fetch data with simple type queries', async () => {
		// Mock Sanity API responses
		server.use(
			// First page of 'test' type
			http.get('https://test-project.api.sanity.io/v2021-10-21/data/query/production', ({ request }) => {
				const url = new URL(request.url);

				const query = url.searchParams.get('query');

				if (query === '*[_type == "test" ][0..99]') {
					return HttpResponse.json({
						result: [
							{ _type: 'test', title: 'Test Document 1' }
						],
						ms: 15
					});
				}

				if (query === '*[_type == "test" ][100..199]') {
					return HttpResponse.json({
						result: [
							{ _type: 'test', title: 'Test Document 2' }
						],
						ms: 15
					});
				}

				if (query === '*[_type == "article" ][0..99]') {
					return HttpResponse.json({
						result: [
							{ _type: 'article', title: 'Article 1' }
						],
						ms: 15
					});
				}

				if (query === '*[_type == "article" ][100..199]') {
					return HttpResponse.json({
						result: [
							{ _type: 'article', title: 'Article 2' }
						],
						ms: 15
					});
				}

				return HttpResponse.json({
					result: [],
					ms: 5
				});
			})
		);

		const source = await sanitySource({
			id: 'test-sanity',
			projectId: 'test-project',
			apiToken: 'test-token',
			queries: ['test', 'article']
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(2);

		// Check 'test' type results
		const testData = await fetchPromises[0].dataPromise;
		expect(testData.isOk()).toBe(true);
		expect(testData._unsafeUnwrap()).toEqual([{
			id: 'test',
			data: [
				{ _type: 'test', title: 'Test Document 1' },
				{ _type: 'test', title: 'Test Document 2' }
			]
		}]);

		// Check 'article' type results
		const articleData = await fetchPromises[1].dataPromise;
		expect(articleData.isOk()).toBe(true);
		expect(articleData._unsafeUnwrap()).toEqual([{
			id: 'article',
			data: [
				{ _type: 'article', title: 'Article 1' },
				{ _type: 'article', title: 'Article 2' }
			]
		}]);
	});

	it('should fetch data with custom query objects', async () => {
		server.use(
			http.get('https://test-project.api.sanity.io/v2021-10-21/data/query/production', ({ request }) => {
				const url = new URL(request.url);
				const query = url.searchParams.get('query');

				if (query === '*[_type == "custom"][0..99]' || query === '*[_type == "custom"][100..199]') {
					return HttpResponse.json({
						result: [
							{ _type: 'custom', data: 'Custom Data' }
						],
						ms: 15
					});
				}

				return HttpResponse.json({
					result: [],
					ms: 5
				});
			})
		);

		const source = await sanitySource({
			id: 'test-sanity',
			projectId: 'test-project',
			apiToken: 'test-token',
			queries: [{
				id: 'custom',
				query: '*[_type == "custom"]'
			}]
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isOk()).toBe(true);
		expect(data._unsafeUnwrap()).toEqual([{
			id: 'custom',
			data: [
				{ _type: 'custom', data: 'Custom Data' },
				{ _type: 'custom', data: 'Custom Data' }
			]
		}]);
	});

	it('should handle API errors', async () => {
		server.use(
			http.get('https://test-project.api.sanity.io/v2021-10-21/data/query/production', () => {
				return new HttpResponse('Internal Server Error', { status: 500 });
			})
		);

		const source = await sanitySource({
			id: 'test-sanity',
			projectId: 'test-project',
			apiToken: 'test-token',
			queries: ['test']
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toBe('fetch');
		expect(data._unsafeUnwrapErr().message).toContain('Could not fetch page');
	});

	it('should respect pagination options', async () => {
		server.use(
			http.get('https://test-project.api.sanity.io/v2021-10-21/data/query/production', ({ request }) => {
				const url = new URL(request.url);
				const query = url.searchParams.get('query') || '';
				const offset = query.match(/\[(\d+)\.\./)?.at(1);

				if (offset === '50') {
					return HttpResponse.json({
						result: [],
						ms: 5
					});
				}

				return HttpResponse.json({
					result: [
						{ _type: 'test', title: `Test Document ${offset}` }
					],
					ms: 15
				});
			})
		);

		const source = await sanitySource({
			id: 'test-sanity',
			projectId: 'test-project',
			apiToken: 'test-token',
			queries: ['test'],
			limit: 50,
			mergePages: false,
			pageNumZeroPad: 2
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isOk()).toBe(true);

		// Check that pagination formatting is correct
		const pages = data._unsafeUnwrap();
		expect(pages[0].id).toBe('test-01');
		expect(pages[0].data).toEqual([
			{ _type: 'test', title: 'Test Document 0' }
		]);
	});
});
