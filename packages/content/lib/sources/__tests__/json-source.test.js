import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import jsonSource from '../json-source.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';
import { DataStore } from '../../utils/data-store.js';

const server = setupServer();

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

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
	vi.useFakeTimers();
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

describe('jsonSource', () => {
	it('should fetch JSON data successfully', async () => {
		server.use(
			http.get('https://api.example.com/data1', () => {
				return HttpResponse.json({ key: 'value1' });
			}),
			http.get('https://api.example.com/data2', () => {
				return HttpResponse.json({ key: 'value2' });
			})
		);

		const source = await jsonSource({
			id: 'test-json',
			files: {
				'data1.json': 'https://api.example.com/data1',
				'data2.json': 'https://api.example.com/data2'
			}
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
    
		expect(result.isOk()).toBe(true);
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(2);

		const data1 = await fetchPromises[0].dataPromise;
		const data2 = await fetchPromises[1].dataPromise;

		expect(data1.isOk()).toBe(true);
		expect(data2.isOk()).toBe(true);

		expect(data1._unsafeUnwrap()).toEqual([{ id: 'data1.json', data: { key: 'value1' } }]);
		expect(data2._unsafeUnwrap()).toEqual([{ id: 'data2.json', data: { key: 'value2' } }]);
	});

	it('should handle fetch errors', async () => {
		server.use(
			http.get('https://api.example.com/error', () => {
				return HttpResponse.error();
			})
		);

		const source = await jsonSource({
			id: 'test-json-error',
			files: {
				'error.json': 'https://api.example.com/error'
			}
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();
    
		const result = await sourceValue.fetch(createFetchContext());

		expect(result.isOk()).toBe(true);
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);

		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toMatch('fetch');
	});

	it('should handle parse errors', async () => {
		server.use(
			http.get('https://api.example.com/invalid', () => {
				return new HttpResponse('Invalid JSON', {
					headers: { 'Content-Type': 'application/json' }
				});
			})
		);

		const source = await jsonSource({
			id: 'test-json-parse-error',
			files: {
				'invalid.json': 'https://api.example.com/invalid'
			}
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());

		expect(result.isOk()).toBe(true);
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);

		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toMatch('parse');
	});

	it('should respect the maxTimeout option', async () => {
		server.use(
			http.get('https://api.example.com/slow', async () => {
				await new Promise(resolve => setTimeout(resolve, 2000));
				return HttpResponse.json({ key: 'value' });
			})
		);

		const source = await jsonSource({
			id: 'test-json-timeout',
			files: {
				'slow.json': 'https://api.example.com/slow'
			},
			maxTimeout: 1000
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
    
		vi.advanceTimersByTime(1000);

		expect(result.isOk()).toBe(true);
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);
    
		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toMatch('fetch');
		expect(data._unsafeUnwrapErr().message).toContain('Request timed out');
	});
});
