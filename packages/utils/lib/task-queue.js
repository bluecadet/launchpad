import * as async from 'async';
import autoBind from 'auto-bind';
import chalk from 'chalk';
import { LogManager, Logger } from './log-manager.js';

export class TaskQueueOptions {
	constructor({
		concurrency = 1
	} = {}) {
		/** @type {number} */
		this.concurrency = concurrency;
	};
}

class TaskQueue {
	/** @type {TaskQueueOptions} */
	_config;
	
	/** @type {async.QueueObject<Task>} */
	_queue;
	
	/** @type {Logger} */
	_logger;
	
	/**
	 * 
	 * @param {TaskQueueOptions} config 
	 * @param {Logger} logger 
	 */
	constructor(config, logger) {
		autoBind(this);
		this._config = new TaskQueueOptions(config);
		this._logger = logger || LogManager.getInstance().getLogger();
		this._queue = async.queue(this._processTask, this._config.concurrency || 1);
		this._queue.drain();
	}
	
	/**
	 * Adds a task to the queue and returns a promise that resolves once the task is complete or rejects if the task experienced an error.
	 * @template {(...args: unknown[]) => void} T
	 * @param {T | T[]} taskFns A single task function or an array of task functions. If multiple tasks are passed, the promise will resolve after all tasks are processed.
	 * @param {string} taskName 
	 * @param {Parameters<T>} args
	 */
	async add(taskFns, taskName = '', ...args) {
		if (!Array.isArray(taskFns)) {
			taskFns = [taskFns];
		}
		const tasks = [];
		for (const taskFn of taskFns) {
			// this._logger.debug(`Adding task ${chalk.blue(task)}`);
			tasks.push(new Task(taskFn, taskName, args));
		}
		return this._queue.pushAsync(tasks);
	}
	
	/**
	 * @param {(node: async.DataContainer<Task>) => boolean} filterFn 
	 */
	clear(filterFn = () => true) {
		return this._queue.remove(filterFn);
	}
	
	/**
	 * @returns {number} number of tasks that remain for processing
	 */
	getNumRemaining() {
		return this._queue.length();
	}
	
	/**
	 * 
	 * @param {Task} task 
	 */
	async _processTask(task) {
		this._logger.debug(`Running task ${chalk.blue(task)}`);
		const result = await task.run();
		this._logger.debug(`Finished task ${chalk.blue(task)}`);
		return result;
	}
	
	/**
	 * @param {Error} err
	 * @param {Task} task
	 */
	async _handleTaskError(err, task) {
		this._logger.error(`Could not run task ${chalk.blue(task)}`, err);
	}
}

/**
 * @template {(...args: unknown[]) => void} [T = (...args: unknown[]) => void]
 */
class Task {
	static __numTasks = 0;
	
	/** @type {number} */
	id = -1;
	/** @type {string} */
	name = '';
	/** @type {T} */
	taskFn;
	/** @type {Parameters<T> | []} */
	args = [];
	
	/**
	 * @param {T} fn
	 * @param {string} [name]
	 * @param {Parameters<T> | []} [args]
	 */
	constructor(fn, name = '', args = []) {
		this.id = (Task.__numTasks++);
		this.taskFn = fn;
		this.name = name;
		this.args = args;
	}
	
	/**
	 * @returns {Promise<void>}
	 */
	async run() {
		if (!this.taskFn) {
			return Promise.resolve();
		} else {
			return this.taskFn(...this.args);
		}
	}
	
	/**
	 * @returns {string}
	 */
	toString() {
		const idStr = `#${this.id}`;
		return this.name ? `${idStr} (${this.name})` : idStr;
	}
}

export default TaskQueue;
export { Task };
