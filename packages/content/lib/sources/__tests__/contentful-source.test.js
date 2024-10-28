import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import contentfulSource from '../contentful-source.js';
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

describe('contentfulSource', () => {
	it('should fail with missing delivery token when not using preview', async () => {
		// @ts-expect-error - testing invalid options
		const result = await contentfulSource({
			id: 'test-contentful',
			space: 'test-space',
			// missing deliveryToken
			usePreviewApi: false
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().type).toBe('config');
		expect(result._unsafeUnwrapErr().message).toContain('no deliveryToken is provided');
	});

	it('should fail with missing preview token when using preview', async () => {
		// @ts-expect-error - testing invalid options
		const result = await contentfulSource({
			id: 'test-contentful',
			space: 'test-space',
			// missing previewToken
			usePreviewApi: true
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().type).toBe('config');
		expect(result._unsafeUnwrapErr().message).toContain('no previewToken is provided');
	});

	it('should fetch data with delivery token', async () => {
		server.use(
			http.get('https://cdn.contentful.com/spaces/test-space/environments/master/entries', ({ request }) => {
				const url = new URL(request.url);
				const skip = parseInt(url.searchParams.get('skip') || '0');

				// Return empty results after first page
				if (skip > 0) {
					return HttpResponse.json({
						items: [],
						includes: {},
						total: 1,
						skip,
						limit: 1000
					});
				}

				return HttpResponse.json({
					items: [
						{
							sys: { type: 'Entry', contentType: { sys: { id: 'article' } } },
							fields: { title: 'Test Entry' }
						}
					],
					includes: {
						Asset: [
							{
								sys: { type: 'Asset', id: 'test-asset' },
								fields: {
									title: 'Test Asset',
									file: { url: '//test.com/image.jpg' }
								}
							}
						]
					},
					total: 1,
					skip: 0,
					limit: 1000
				});
			})
		);

		const source = await contentfulSource({
			id: 'test-contentful',
			space: 'test-space',
			deliveryToken: 'test-token',
			usePreviewApi: false
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);

		const data = await fetchPromises[0].dataPromise;
		expect(data.isOk()).toBe(true);
		
		const content = data._unsafeUnwrap();
		expect(content).toHaveLength(1);
		expect(content[0].id).toBe('content.json');
		expect(content[0].data.entries).toHaveLength(1);
		expect(content[0].data.assets).toHaveLength(1);
		
		// Check first entry
		expect(content[0].data.entries[0]).toEqual({
			sys: { type: 'Entry', contentType: { sys: { id: 'article' } } },
			fields: { title: 'Test Entry' }
		});
	});

	it('should fetch data with preview token', async () => {
		server.use(
			http.get('https://preview.contentful.com/spaces/test-space/environments/master/entries', ({ request }) => {
				const url = new URL(request.url);
				const skip = parseInt(url.searchParams.get('skip') || '0');

				if (skip > 0) {
					return HttpResponse.json({
						items: [],
						includes: {},
						total: 1,
						skip,
						limit: 1000
					});
				}

				return HttpResponse.json({
					items: [
						{
							sys: { type: 'Entry', contentType: { sys: { id: 'article' } } },
							fields: { title: 'Preview Entry' }
						}
					],
					includes: {
						Asset: [
							{
								sys: { type: 'Asset' },
								fields: {
									title: 'Preview Asset',
									file: { url: '//test.com/preview.jpg' }
								}
							}
						]
					},
					total: 1,
					skip: 0,
					limit: 1000
				});
			})
		);

		const source = await contentfulSource({
			id: 'test-contentful',
			space: 'test-space',
			previewToken: 'test-preview-token',
			usePreviewApi: true
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isOk()).toBe(true);

		const content = data._unsafeUnwrap();

		expect(content).toMatchInlineSnapshot(`
			[
			  {
			    "data": {
			      "assets": [
			        {
			          "fields": {
			            "file": {
			              "url": "//test.com/preview.jpg",
			            },
			            "title": "Preview Asset",
			          },
			          "sys": {
			            "type": "Asset",
			          },
			        },
			      ],
			      "entries": [
			        {
			          "fields": {
			            "title": "Preview Entry",
			          },
			          "sys": {
			            "contentType": {
			              "sys": {
			                "id": "article",
			              },
			            },
			            "type": "Entry",
			          },
			        },
			      ],
			    },
			    "id": "content.json",
			  },
			]
		`);
	});

	it('should handle API errors', async () => {
		server.use(
			http.get('https://cdn.contentful.com/spaces/test-space/environments/master/entries', () => {
				return new HttpResponse('Internal Server Error', { status: 500 });
			})
		);

		const source = await contentfulSource({
			id: 'test-contentful',
			space: 'test-space',
			deliveryToken: 'test-token',
			retryOnError: false
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toBe('fetch');
		expect(data._unsafeUnwrapErr().message).toContain('Error fetching page');
	});

	it('should handle contentful errors array', async () => {
		server.use(
			http.get('https://cdn.contentful.com/spaces/test-space/environments/master/entries', () => {
				return HttpResponse.json({
					sys: { type: 'Error' },
					errors: [{ message: 'Invalid content type' }]
				});
			})
		);

		const source = await contentfulSource({
			id: 'test-contentful',
			space: 'test-space',
			deliveryToken: 'test-token'
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toBe('fetch');
		expect(data._unsafeUnwrapErr().message).toContain('Invalid content type');
	});

	it('should respect content type filtering', async () => {
		server.use(
			http.get('https://cdn.contentful.com/spaces/test-space/environments/master/entries', ({ request }) => {
				const url = new URL(request.url);
				const contentType = url.searchParams.get('sys.contentType.sys.id[in]');
				
				expect(contentType).toBe('article');

				const skip = parseInt(url.searchParams.get('skip') || '0');

				if (skip > 0) {
					return HttpResponse.json({
						items: [],
						includes: {},
						total: 1,
						skip,
						limit: 1000
					});
				}

				return HttpResponse.json({
					items: [
						{
							sys: { type: 'Entry', contentType: { sys: { id: 'article' } } },
							fields: { title: 'Filtered Entry' }
						}
					],
					includes: {},
					total: 1,
					skip: 0,
					limit: 1000
				});
			})
		);

		const source = await contentfulSource({
			id: 'test-contentful',
			space: 'test-space',
			deliveryToken: 'test-token',
			contentTypes: ['article'],
			retryOnError: false
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;

		expect(data.isOk()).toBe(true);

		const content = data._unsafeUnwrap();
		expect(content[0].data.entries.every(entry =>
			entry.sys.contentType.sys.id === 'article'
		)).toBe(true);
	});
});
