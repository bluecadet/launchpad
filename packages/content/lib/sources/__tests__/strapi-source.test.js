import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import strapiSource from '../strapi-source.js';
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

vi.mock('ky', async (importOriginal) => {
	/** @type {import('ky')} */
	const ky = await importOriginal();
	return {
		default: ky.default.extend({
			retry: {
				limit: 0
			}
		})
	};
});

function createFetchContext() {
	return {
		logger: createMockLogger(),
		dataStore: new DataStore()
	};
}

describe('strapiSource', () => {
	it('should fail with unsupported version', async () => {
		const result = await strapiSource({
			id: 'test-strapi',
			baseUrl: 'http://localhost:1337',
			identifier: 'test@example.com',
			password: 'password',
			// @ts-expect-error - testing invalid version
			version: '5',
			queries: ['test-content']
		});

		expect(result).toBeErr();
		expect(result._unsafeUnwrapErr().type).toBe('config');
		expect(result._unsafeUnwrapErr().message).toContain('Unsupported strapi version');
	});

	describe('Strapi v4', () => {
		it('should authenticate and fetch data successfully', async () => {
			server.use(
				// Auth endpoint
				http.post('http://localhost:1337/auth/local', async ({ request }) => {
					const body = await request.json();
					expect(body).toEqual({
						identifier: 'test@example.com',
						password: 'password'
					});

					return HttpResponse.json({
						jwt: 'test-token'
					});
				}),
				// Data endpoint
				http.get('http://localhost:1337/api/test-content', ({ request }) => {
					const authHeader = request.headers.get('Authorization');
					expect(authHeader).toBe('Bearer test-token');

					const url = new URL(request.url);
					const page = parseInt(url.searchParams.get('pagination[page]') || '1');

					// Return empty results after first page
					if (page > 1) {
						return HttpResponse.json({
							data: [],
							meta: {
								pagination: {
									page,
									pageSize: 100,
									pageCount: 1,
									total: 1
								}
							}
						});
					}

					return HttpResponse.json({
						data: [
							{
								id: 1,
								attributes: {
									title: 'Test Content',
									description: 'Test Description'
								}
							}
						],
						meta: {
							pagination: {
								page: 1,
								pageSize: 100,
								pageCount: 1,
								total: 1
							}
						}
					});
				})
			);

			const source = await strapiSource({
				id: 'test-strapi',
				version: '4',
				baseUrl: 'http://localhost:1337',
				identifier: 'test@example.com',
				password: 'password',
				queries: ['test-content']
			});

			expect(source).toBeOk();
			const sourceValue = source._unsafeUnwrap();

			const result = await sourceValue.fetch(createFetchContext());
			expect(result).toBeOk();

			const fetchPromises = result._unsafeUnwrap();
			const data = await fetchPromises[0].dataPromise;
			expect(data).toBeOk();

			const content = data._unsafeUnwrap();
			expect(content).toMatchInlineSnapshot(`
				[
				  {
				    "data": [
				      {
				        "attributes": {
				          "description": "Test Description",
				          "title": "Test Content",
				        },
				        "id": 1,
				      },
				    ],
				    "id": "test-content-01.json",
				  },
				]
			`);
		});

		it('should handle custom query objects', async () => {
			server.use(
				http.post('http://localhost:1337/auth/local', () => {
					return HttpResponse.json({ jwt: 'test-token' });
				}),
				http.get('http://localhost:1337/api/custom-content', ({ request }) => {
					const url = new URL(request.url);
					expect(url.searchParams.get('filters[type][$eq]')).toBe('test');
					expect(url.searchParams.get('sort[0]')).toBe('createdAt:desc');

					if (url.searchParams.get('pagination[page]') === '2') {
						return HttpResponse.json({
							data: [],
							meta: {
								pagination: { page: 2, pageSize: 100, pageCount: 1, total: 0 }
							}
						});
					}

					return HttpResponse.json({
						data: [
							{
								id: 1,
								attributes: {
									title: 'Custom Content',
									type: 'test'
								}
							}
						],
						meta: {
							pagination: {
								page: 1,
								pageSize: 100,
								pageCount: 1,
								total: 1
							}
						}
					});
				})
			);

			const source = await strapiSource({
				id: 'test-strapi',
				version: '4',
				baseUrl: 'http://localhost:1337',
				identifier: 'test@example.com',
				password: 'password',
				queries: [{
					contentType: 'custom-content',
					params: {
						'filters[type][$eq]': 'test',
						'sort[0]': 'createdAt:desc'
					}
				}]
			});

			expect(source).toBeOk();
			const sourceValue = source._unsafeUnwrap();

			const result = await sourceValue.fetch(createFetchContext());
			expect(result).toBeOk();

			const fetchPromises = result._unsafeUnwrap();
			const data = await fetchPromises[0].dataPromise;

			expect(data).toBeOk();

			const content = data._unsafeUnwrap();
			expect(content[0].data).toMatchInlineSnapshot(`
				[
				  {
				    "attributes": {
				      "title": "Custom Content",
				      "type": "test",
				    },
				    "id": 1,
				  },
				]
			`);
		});
	});

	describe('Strapi v3', () => {
		it('should authenticate and fetch data successfully', async () => {
			server.use(
				http.post('http://localhost:1337/auth/local', async ({ request }) => {
					const body = await request.json();
					expect(body).toEqual({
						identifier: 'test@example.com',
						password: 'password'
					});

					return HttpResponse.json({
						jwt: 'test-token'
					});
				}),
				http.get('http://localhost:1337/api/test-content', ({ request }) => {
					const authHeader = request.headers.get('Authorization');
					expect(authHeader).toBe('Bearer test-token');

					const url = new URL(request.url);
					const start = parseInt(url.searchParams.get('_start') || '0');

					// Return empty results after first page
					if (start > 0) {
						return HttpResponse.json([]);
					}

					return HttpResponse.json([
						{
							id: 1,
							title: 'Test Content V3',
							description: 'Test Description V3'
						}
					]);
				})
			);

			const source = await strapiSource({
				id: 'test-strapi',
				version: '3',
				baseUrl: 'http://localhost:1337',
				identifier: 'test@example.com',
				password: 'password',
				queries: ['test-content']
			});

			expect(source).toBeOk();
			const sourceValue = source._unsafeUnwrap();

			const result = await sourceValue.fetch(createFetchContext());
			expect(result).toBeOk();

			const fetchPromises = result._unsafeUnwrap();
			const data = await fetchPromises[0].dataPromise;
			expect(data).toBeOk();

			const content = data._unsafeUnwrap();
			expect(content).toMatchInlineSnapshot(`
				[
				  {
				    "data": [
				      {
				        "description": "Test Description V3",
				        "id": 1,
				        "title": "Test Content V3",
				      },
				    ],
				    "id": "test-content-01.json",
				  },
				]
			`);
		});
	});

	it('should handle authentication errors', async () => {
		server.use(
			http.post('http://localhost:1337/auth/local', () => {
				return new HttpResponse('Invalid credentials', { status: 401 });
			})
		);

		const source = await strapiSource({
			id: 'test-strapi',
			version: '4',
			baseUrl: 'http://localhost:1337',
			identifier: 'test@example.com',
			password: 'wrong-password',
			queries: ['test-content']
		});

		expect(source).toBeErr();
		const sourceValue = source._unsafeUnwrapErr();
		expect(sourceValue.type).toBe('fetch');
		expect(sourceValue.message).toContain('401');
	});

	it('should handle API errors', async () => {
		server.use(
			http.post('http://localhost:1337/auth/local', () => {
				return HttpResponse.json({ jwt: 'test-token' });
			}),
			http.get('http://localhost:1337/api/test-content', () => {
				return new HttpResponse('Internal Server Error', { status: 500 });
			})
		);

		const source = await strapiSource({
			id: 'test-strapi',
			version: '4',
			baseUrl: 'http://localhost:1337',
			identifier: 'test@example.com',
			password: 'password',
			queries: ['test-content']
		});

		expect(source).toBeOk();
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result).toBeOk();

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;

		expect(data).toBeErr();
		expect(data._unsafeUnwrapErr().type).toBe('fetch');
		expect(data._unsafeUnwrapErr().message).toContain('Could not fetch page');
	});
});
