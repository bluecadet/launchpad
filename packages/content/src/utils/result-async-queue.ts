import type { Logger } from "@bluecadet/launchpad-utils";
import chalk from "chalk";
import { Result, ResultAsync, err, ok } from "neverthrow";
import PQueue from "p-queue";

type ResultAsyncTaskOptions = {
	signal?: AbortSignal;
};

export type ResultAsyncTask<TaskResultType, TaskErrorType> = (
	options: ResultAsyncTaskOptions,
) => ResultAsync<TaskResultType, TaskErrorType>;

/**
 * Wraps a PQueue instance to provide a ResultAsync interface.
 */
export default class ResultAsyncQueue {
	queue: PQueue;

	constructor(options?: ConstructorParameters<typeof PQueue>[0]) {
		this.queue = new PQueue(options);
	}

	/**
	 * Add a ResultAsync to the queue, returning a ResultAsync that resolves to the task's result, or void if the task is aborted.
	 */
	add<TaskResultType, TaskErrorType>(
		task: ResultAsyncTask<TaskResultType, TaskErrorType>,
	): ResultAsync<TaskResultType | undefined, TaskErrorType> {
		return ResultAsync.fromSafePromise(this.queue.add(task)).andThen((result) => {
			if (!result) {
				return ok(undefined);
			}
			return result;
		});
	}

	addAll<TaskResultType, TaskErrorType>(
		tasks: Array<ResultAsyncTask<TaskResultType, TaskErrorType>>,
		options: { logger: Logger; abortOnError?: boolean },
	): ResultAsync<Array<TaskResultType>, Array<TaskErrorType>> {
		let wrappedTasks = tasks;

		if (options.abortOnError) {
			wrappedTasks = tasks.map((task) => {
				return (...args) =>
					task(...args).mapErr((e) => {
						this.queue.clear();
						options.logger.error(
							`Cancelled ${chalk.red(`${this.queue.size} remaining sync tasks`)} due to ${chalk.red("error")}:`,
						);
						return e;
					});
			});
		}

		return ResultAsync.fromSafePromise(this.queue.addAll(tasks)).andThen((val) => {
			return Result.combineWithAllErrors(val);
		});
	}
}
