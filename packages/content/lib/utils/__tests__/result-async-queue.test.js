import { describe, it, expect } from 'vitest';
import { ResultAsync } from 'neverthrow';
import ResultAsyncQueue from '../result-async-queue.js';
import { createMockLogger } from '@bluecadet/launchpad-testing/test-utils.js';

describe('ResultAsyncQueue', () => {
	it('should add and process a single task', async () => {
		const queue = new ResultAsyncQueue();
		const task = () => ResultAsync.fromPromise(
			Promise.resolve(42),
			() => new Error('Task failed')
		);

		const result = await queue.add(task);
		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe(42);
	});

	it('should handle errors in tasks', async () => {
		const queue = new ResultAsyncQueue();
		const task = () => ResultAsync.fromPromise(
			Promise.reject(new Error('Task failed')),
			(error) => error instanceof Error ? error : new Error(String(error))
		);

		const result = await queue.add(task);
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe('Task failed');
	});

	it('should process multiple tasks in order', async () => {
		const queue = new ResultAsyncQueue({ concurrency: 1 });
		/** @type {Array<number | undefined>} */
		const results = [];
		const tasks = [
			() => ResultAsync.fromPromise(Promise.resolve(1), () => new Error()),
			() => ResultAsync.fromPromise(Promise.resolve(2), () => new Error()),
			() => ResultAsync.fromPromise(Promise.resolve(3), () => new Error())
		];

		await Promise.all(tasks.map(task =>
			queue.add(task).map(value => results.push(value))
		));

		expect(results).toEqual([1, 2, 3]);
	});

	it('should handle addAll with successful tasks', async () => {
		const queue = new ResultAsyncQueue();
		const logger = createMockLogger();
		const tasks = [
			() => ResultAsync.fromPromise(Promise.resolve(1), () => new Error()),
			() => ResultAsync.fromPromise(Promise.resolve(2), () => new Error())
		];

		const result = await queue.addAll(tasks, { logger });
		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual([1, 2]);
	});

	it('should handle addAll with abortOnError', async () => {
		const queue = new ResultAsyncQueue();
		const logger = createMockLogger();
		const tasks = [
			() => ResultAsync.fromPromise(Promise.resolve(1), () => new Error()),
			() => ResultAsync.fromPromise(Promise.reject(new Error('Task 2 failed')), error => error instanceof Error ? error : new Error(String(error))),
			() => ResultAsync.fromPromise(Promise.resolve(3), () => new Error())
		];

		const result = await queue.addAll(tasks, { logger, abortOnError: true });
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toHaveLength(1);
		expect(result._unsafeUnwrapErr()[0].message).toBe('Task 2 failed');
	});

	it('should handle aborted tasks', async () => {
		const queue = new ResultAsyncQueue();
		const abortController = new AbortController();

		/**
     * @param {object} options
     * @param {AbortSignal} options.signal
     */
		const task = ({ signal }) => ResultAsync.fromPromise(
			new Promise((resolve) => {
				const timeout = setTimeout(() => resolve(42), 1000);
				signal.addEventListener('abort', () => {
					clearTimeout(timeout);
					resolve(undefined);
				});
			}),
			() => new Error('Task failed')
		);

		const resultPromise = queue.add(() => task({ signal: abortController.signal }));
		abortController.abort();
		const result = await resultPromise;

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe(undefined);
	});
});
