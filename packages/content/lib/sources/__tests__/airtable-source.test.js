import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import airtableSource from '../airtable-source.js';
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

describe('airtableSource', () => {
	it('should fetch regular table data successfully', async () => {
		server.use(
			http.get('https://api.airtable.com/v0/regular-base/table1', async ({ request }) => {
				const authHeader = request.headers.get('Authorization');
				expect(authHeader).toBe('Bearer test-key');

				const url = new URL(request.url);
				const offset = url.searchParams.get('offset');

				// Return empty results after first page
				if (offset) {
					return HttpResponse.json({
						records: []
					});
				}

				return HttpResponse.json({
					records: [
						{
							id: '1',
							fields: { name: 'Test 1', value: 'Value 1' },
							createdTime: '2024-01-01'
						},
						{
							id: '2',
							fields: { name: 'Test 2', value: 'Value 2' },
							createdTime: '2024-01-02'
						}
					],
					offset: 'next_page_token'
				});
			})
		);

		const source = await airtableSource({
			id: 'test-airtable',
			baseId: 'regular-base',
			apiKey: 'test-key',
			tables: ['table1']
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
    
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		expect(fetchPromises).toHaveLength(1);

		const data = await fetchPromises[0].dataPromise;

		expect(data.isOk()).toBe(true);

		const tableData = data._unsafeUnwrap();
		expect(tableData).toHaveLength(2); // raw and simplified data

		// Check raw data
		expect(tableData[0].id).toBe('table1.raw');
		expect(tableData[0].data).toHaveLength(2);
		// Check simplified data
		expect(tableData[1].id).toBe('table1');
		expect(tableData[1].data).toMatchInlineSnapshot(`
			[
			  {
			    "id": "1",
			    "name": "Test 1",
			    "value": "Value 1",
			  },
			  {
			    "id": "2",
			    "name": "Test 2",
			    "value": "Value 2",
			  },
			]
		`);
	});

	it('should fetch and transform key-value table data successfully', async () => {
		server.use(
			http.get('https://api.airtable.com/v0/kv-base/settings', ({ request }) => {
				const authHeader = request.headers.get('Authorization');
				expect(authHeader).toBe('Bearer test-key');

				const url = new URL(request.url);
				const offset = url.searchParams.get('offset');

				if (offset) {
					return HttpResponse.json({
						records: []
					});
				}

				return HttpResponse.json({
					records: [
						{
							id: '1',
							fields: { key: 'key1', value: 'value1' },
							createdTime: '2024-01-01'
						},
						{
							id: '2',
							fields: { key: 'key2', value: '123' },
							createdTime: '2024-01-01'
						},
						{
							id: '3',
							fields: { key: 'key3', value: 'true' },
							createdTime: '2024-01-01'
						},
						{
							id: '4',
							fields: { key: 'array[0]', value: 'first' },
							createdTime: '2024-01-01'
						},
						{
							id: '5',
							fields: { key: 'array[1]', value: 'second' },
							createdTime: '2024-01-01'
						}
					]
				});
			})
		);

		const source = await airtableSource({
			id: 'test-airtable',
			baseId: 'kv-base',
			apiKey: 'test-key',
			keyValueTables: ['settings']
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isOk()).toBe(true);

		const tableData = data._unsafeUnwrap();
		expect(tableData).toHaveLength(2); // raw and simplified data

		// Check simplified data
		expect(tableData[1].id).toBe('settings');
		expect(tableData[1].data).toEqual({
			key1: 'value1',
			key2: 123, // numeric string converted to number
			key3: true, // 'true' string converted to boolean
			array: ['first', 'second'] // array[0] and array[1] combined
		});
	});

	it('should handle API errors', async () => {
		server.use(
			http.get('https://api.airtable.com/v0/error-base/error-table', () => {
				return new HttpResponse('Internal Server Error', { status: 500 });
			})
		);

		const source = await airtableSource({
			id: 'test-airtable',
			baseId: 'error-base',
			apiKey: 'test-key',
			tables: ['error-table']
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toBe('fetch');
		expect(data._unsafeUnwrapErr().message).toContain('Failed to fetch data from Airtable');
	});

	it('should handle invalid key-value table data', async () => {
		server.use(
			http.get('https://api.airtable.com/v0/invalid-kv-base/invalid-table', () => {
				return HttpResponse.json({
					records: [
						{
							id: '1',
							fields: { single_column: 'invalid' },
							createdTime: '2024-01-01'
						}
					]
				});
			})
		);

		const source = await airtableSource({
			id: 'test-airtable',
			baseId: 'invalid-kv-base',
			apiKey: 'test-key',
			keyValueTables: ['invalid-table']
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;

		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toBe('parse');
		expect(data._unsafeUnwrapErr().message).toContain('At least 2 columns required');
	});

	it('should handle unauthorized access', async () => {
		server.use(
			http.get('https://api.airtable.com/v0/unauthorized-base/table', () => {
				return new HttpResponse('Unauthorized', { status: 401 });
			})
		);

		const source = await airtableSource({
			id: 'test-airtable',
			baseId: 'unauthorized-base',
			apiKey: 'invalid-key',
			tables: ['table']
		});

		expect(source.isOk()).toBe(true);
		const sourceValue = source._unsafeUnwrap();

		const result = await sourceValue.fetch(createFetchContext());
		expect(result.isOk()).toBe(true);

		const fetchPromises = result._unsafeUnwrap();
		const data = await fetchPromises[0].dataPromise;
		expect(data.isErr()).toBe(true);
		expect(data._unsafeUnwrapErr().type).toBe('fetch');
		expect(data._unsafeUnwrapErr().message).toContain('Failed to fetch data from Airtable');
	});
});
