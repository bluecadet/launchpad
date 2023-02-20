import chalk from 'chalk';
import autoBind from 'auto-bind';
import { LogManager, Logger, TaskQueue, TaskQueueOptions, execScript } from '@bluecadet/launchpad-utils';
import CommandHooks from './command-hooks.js';

export class CommandOptions {
	constructor({
		tasks = new TaskQueueOptions()
	} = {}) {
		/**
		 * @type {TaskQueueOptions}
		 */
		this.tasks = new TaskQueueOptions(tasks);
	}
}

export class CommandCenter {
	/** @type {CommandOptions} */
	_config = {};
	
	/** @type {Logger} */
	_logger = null;
	
	/** @type {Map<string, Command>} */
	_commands = new Map();
	
	/** @type {TaskQueue} */
	_tasks = null;
	
	/**
	 * 
	 * @param {CommandOptions|Object} config 
	 * @param {*} logger 
	 */
	constructor(config = null, logger = null) {
		autoBind(this);
		this._config = new CommandOptions(config);
		this._logger = logger || LogManager.getInstance().getLogger();
		this._tasks = new TaskQueue(this._config.tasks, this._logger);
	}
	
	/**
	 * 
	 * @param {Command} command The command to map
	 */
	add(command) {
		if (this._commands.has(command.name)) {
			this._logger.warn(`Overriding command: ${chalk.blue(command.name)}`);
		}
		command.logger = this._logger;
		this._commands.set(command.name, command);
	}
	
	/**
	 * 
	 * @param {string} commandName The name of the command to run
	 * @returns {Promise} The promise returned by the command function
	 */
	async run(commandName, ...args) {
		if (!this._commands.has(commandName)) {
			return Promise.reject(new Error(`Command not found: '${commandName}'`));
		}
		
		this._logger.info(`Running command: ${chalk.blue(commandName)}`);
		const command = this._commands.get(commandName);
		
		if (command.queued) {
			return this._tasks.add(command.run, command.name, ...args);
		} else {
			return command.run(...args);
		}
	}
	
	/**
	 * @param {CommandHooks} hooks 
	 */
	addCommandHooks(commandHooks) {
		const add = (hooks, isPre) => {
			const label = isPre ? 'pre' : 'post';
			for (const hook of hooks) {
				try {
					this._logger.info(`Adding ${label}-hook for ${chalk.blue(hook.command)}: '${hook.script}'`);
					const fn = async () => {
						this._logger.info(`Running ${chalk.magenta(`${label}-hook`)} for ${chalk.blue(hook.command)}: '${hook.script}'`);
						return execScript(hook.script, null, this._logger);
					};
					this.addHook(hook.command, isPre ? fn : null, isPre ? null : fn);
				} catch (err) {
					this._logger.error(`Can't add ${label}-hook '${hook.script}' for '${chalk.blue(hook.command)}':`, err);
					execScript(hook.command, null, this._logger);
				}
			}
		};
		add(commandHooks.preHooks, true);
		add(commandHooks.postHooks, false);
	}
	
	/**
	 * 
	 * @param {string} commandName 
	 * @param {function():Promise} before Called before the command is run
	 * @param {function():Promise} after Called after the command was run
	 */
	addHook(commandName, before = null, after = null) {
		if (!this._commands.has(commandName)) {
			throw new Error(`Command not found: '${commandName}'`);
		}
		const command = this._commands.get(commandName);
		if (before) {
			command.preHooks.push(before);
			this._logger.debug(`Added pre-hook for: ${chalk.blue(commandName)}`);
		}
		if (after) {
			command.postHooks.push(after);
			this._logger.debug(`Added post-hook for: ${chalk.blue(commandName)}`);
		}
	}
}

export class Command {
	constructor({
		name,
		callback,
		help = '',
		queued = true,
		logger = null
	} = {}) {
		autoBind(this);
		/**
		 * The name of the command used for running.
		 * @type {string}
		 */
		this.name = name;
		/**
		 * The callback to trigger. Will receives args passed via run().
		 * @type {function():Promise}
		 */
		this.callback = callback;
		/**
		 * Optional help text to display when running this app with --help
		 * @type {string}
		 */
		this.help = help;
		/**
		 * Execute this task on the central queue. Defaults to true.
		 * @type {boolean}
		 */
		this.queued = queued;
		/**
		 * Callbacks that will be triggered before the command is executed.
		 * @type {Array<function():Promise>}
		 */
		this.preHooks = [];
		/**
		* Callbacks that will be triggered after the command was executed.
		* @type {Array<function():Promise>}
		*/
		this.postHooks = [];
		/**
		 * @type {Logger}
		 */
		this.logger = logger;
	}
	
	/**
	 * Runs a command with optional pre- and post-command hooks.
	 * @param  {...any} args 
	 * @returns {*} Results of this command's callback function, if any
	 */
	async run(...args) {
		const logger = this.logger || console;
		for (const fn of this.preHooks) {
			try {
				await fn(...args);
			} catch (err) {
				logger.error(`Could not run pre-hook for command ${chalk.blue(this.name)}:`, err);
			}
		}
		let result = null;
		try {
			result = await this.callback(...args);
		} catch (err) {
			logger.error(`Could not run command ${chalk.blue(this.name)}:`, err);
		}
		for (const fn of this.postHooks) {
			try {
				await fn(...args);
			} catch (err) {
				logger.error(`Could not run post-hook for command ${chalk.blue(this.name)}:`, err);
			}
		}
		
		return result;
	}
	
	toString() {
		return this.name;
	}
}

export default CommandCenter;
