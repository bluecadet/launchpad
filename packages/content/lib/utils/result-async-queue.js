import chalk from 'chalk';
import { ResultAsync, Result, ok, err } from 'neverthrow';
import PQueue from 'p-queue';

/**
 * @typedef ResultAsyncTaskOptions
 * @property {AbortSignal} [signal] 
 */

/**
 * @template {unknown} TaskResultType
 * @template {unknown} TaskErrorType
 * @typedef {(options: ResultAsyncTaskOptions) => ResultAsync<TaskResultType, TaskErrorType>} ResultAsyncTask
 */

/**
 * Wraps a PQueue instance to provide a ResultAsync interface.
 */
export default class ResultAsyncQueue {
	/**
	 * @param {ConstructorParameters<typeof PQueue>[0]} options
	 */
	constructor(options) {
		this.queue = new PQueue(options);
	}

	/**
	 * Add a ResultAsync to the queue, returning a ResultAsync that resolves to the task's result, or void if the task is aborted.
	 * @template {unknown} TaskResultType
	 * @template {unknown} TaskErrorType
	 * @param {ResultAsyncTask<TaskResultType, TaskErrorType>} task
	 * @returns {ResultAsync<TaskResultType | undefined, TaskErrorType>}
   */
	add(task) {
		return ResultAsync.fromSafePromise(this.queue.add(task)).andThen(result => {
			if (!result) {
				return ok(undefined);
			}
			return result;
		});
	}

	/**
	 * @template {unknown} TaskResultType
	 * @template {unknown} TaskErrorType
	 * @param {Array<ResultAsyncTask<TaskResultType, TaskErrorType>>} tasks
	 * @param {object} options
	 * @param {import('@bluecadet/launchpad-utils').Logger} options.logger
	 * @param {boolean} [options.abortOnError] if true, the queue will stop
	 */
	addAll(tasks, options) {
		let wrappedTasks = tasks;

		if (options.abortOnError) {
			wrappedTasks = tasks.map(task => {
				return (...args) => task(...args).mapErr(e => {
					this.queue.clear();
					options.logger.error(`Cancelled ${chalk.red(this.queue.size + ' remaining sync tasks')} due to ${chalk.red('error')}:`);
					return e;
				});
			});
		};

		return ResultAsync.fromSafePromise(this.queue.addAll(tasks)).andThen(val => {
			return Result.combineWithAllErrors(val);
		});
	}
}
