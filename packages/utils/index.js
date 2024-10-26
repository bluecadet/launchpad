export { default as onExit } from './lib/on-exit.js';
export { default as execScript } from './lib/exec-script.js';
export { default as launchFromCli } from './lib/launch-from-cli.js';
export { default as LogManager } from './lib/log-manager.js';
export * from './lib/config.js';
export { default as TaskQueue, Task } from './lib/task-queue.js';

/**
 * @typedef {import('./lib/log-manager.js').Logger} Logger
 */
