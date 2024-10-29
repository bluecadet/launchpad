import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchPaginated } from '../fetch-paginated.js';
import { ResultAsync } from 'neverthrow';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';
import { fetchError } from '../../sources/source-errors.js';

const server = setupServer();

beforeAll(() => { server.listen({ onUnhandledRequest: 'error' }); });
afterAll(() => server.close());
afterEach(() => {
	server.resetHandlers();
	vi.restoreAllMocks();
});

describe('fetchPaginated', () => {
	const mockLogger = createMockLogger();

	it('empty test', async () => {
		expect(true).toBe(true);
	});

	it('should fetch all pages successfully', async () => {
		let callCount = 0;
		server.use(
			http.get('http://example.com/api', ({ request }) => {
				const url = new URL(request.url);
				const limit = Number(url.searchParams.get('limit'));
				const offset = Number(url.searchParams.get('offset'));
				callCount++;

				if (offset >= 30) {
					return HttpResponse.json([]);
				}

				return HttpResponse.json(Array.from({ length: limit }, (_, i) => ({ id: offset + i + 1 })));
			})
		);

		const result = await fetchPaginated({
			limit: 10,
			logger: mockLogger,
			fetchPageFn: ({ limit, offset }) =>
				ResultAsync.fromPromise(
					fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then(res => res.json()),
					() => fetchError('Failed to fetch')
				)
		});

		expect(result).toBeOk();
		const data = result._unsafeUnwrap();
		expect(data.pages).toHaveLength(3);
		expect(data.pages.flat()).toHaveLength(30);
		expect(callCount).toBe(4); // 3 successful calls + 1 empty result
	});

	it('should handle early termination', async () => {
		let callCount = 0;
		server.use(
			http.get('http://example.com/api', () => {
				callCount++;
				if (callCount === 2) {
					return HttpResponse.json([]);
				}
				return HttpResponse.json([{ id: callCount }]);
			})
		);

		const result = await fetchPaginated({
			limit: 1,
			logger: mockLogger,
			fetchPageFn: ({ limit, offset }) =>
				ResultAsync.fromPromise(
					fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then(res => res.json()),
					() => fetchError('Failed to fetch')
				)
		});

		expect(result).toBeOk();
		const data = result._unsafeUnwrap();
		expect(data.pages).toHaveLength(1);
		expect(callCount).toBe(2);
	});

	it('should handle fetch errors', async () => {
		server.use(
			http.get('http://example.com/api', () => {
				return new HttpResponse(null, { status: 500 });
			})
		);

		const result = await fetchPaginated({
			limit: 10,
			logger: mockLogger,
			fetchPageFn: ({ limit, offset }) =>
				ResultAsync.fromPromise(
					fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then(res => {
						if (!res.ok) throw new Error('API error');
						return res.json();
					}),
					() => fetchError('Failed to fetch')
				)
		});

		expect(result).toBeErr();
		const error = result._unsafeUnwrapErr();
		expect(error.type).toBe('fetch');
		expect(error.message).toBe('Failed to fetch');
	});

	it('should include meta data when provided', async () => {
		server.use(
			http.get('http://example.com/api', ({ request }) => {
				const url = new URL(request.url);
				const offset = Number(url.searchParams.get('offset'));
				if (offset === 0) {
					return HttpResponse.json([{ id: 1 }]);
				}
				return HttpResponse.json([]);
			})
		);

		const result = await fetchPaginated({
			limit: 10,
			logger: mockLogger,
			meta: { totalCount: 1 },
			fetchPageFn: ({ limit, offset }) =>
				ResultAsync.fromPromise(
					fetch(`http://example.com/api?limit=${limit}&offset=${offset}`).then(res => res.json()),
					() => fetchError('Failed to fetch')
				)
		});

		expect(result).toBeOk();
		const data = result._unsafeUnwrap();
		expect(data.pages).toHaveLength(1);
		expect(data.meta).toEqual({ totalCount: 1 });
	});
});
