import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import jsonSource from '../json-source.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';
import { DataStore } from '../../utils/data-store.js';
import { SourceFetchError, SourceParseError } from '../source.js';

const server = setupServer();

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

		expect(source).toBeOk();
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
    
		expect(result).toBeOk();
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(2);

		const data1 = await fetchPromises[0].dataPromise;
		const data2 = await fetchPromises[1].dataPromise;

		expect(data1).toBeOk();
		expect(data2).toBeOk();

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

		expect(source).toBeOk();
		const sourceValue = source._unsafeUnwrap();
    
		const result = await sourceValue.fetch(createFetchContext());

		expect(result).toBeOk();
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);

		const data = await fetchPromises[0].dataPromise;
		expect(data).toBeErr();
		expect(data._unsafeUnwrapErr()).toBeInstanceOf(SourceFetchError);
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

		expect(source).toBeOk();
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());

		expect(result).toBeOk();
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);

		const data = await fetchPromises[0].dataPromise;
		expect(data).toBeErr();
		expect(data._unsafeUnwrapErr()).toBeInstanceOf(SourceParseError);
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

		expect(source).toBeOk();
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
    
		vi.advanceTimersByTime(1000);

		expect(result).toBeOk();
		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);
    
		const data = await fetchPromises[0].dataPromise;
		expect(data).toBeErr();
		expect(data._unsafeUnwrapErr()).toBeInstanceOf(SourceFetchError);
		expect(data._unsafeUnwrapErr().message).toContain('Could not fetch json from https://api.example.com/slow');
		// @ts-expect-error cause is unknown
		expect(data._unsafeUnwrapErr().cause.message).toContain('Error during request');
		// @ts-expect-error cause is unknown
		expect(data._unsafeUnwrapErr().cause.cause.message).toContain('Request timed out');
	});
});
